-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION 054: FIX NOTIFICATION CONTEXT LOSS
-- Date: 2026-01-20
-- Status: CRITICAL-FIX | PRODUCTION-SAFE | BACKWARD-COMPATIBLE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- ROOT CAUSE:
--   Migration 052 process_notification_queue() was inserting notifications
--   WITHOUT metadata field, causing:
--   - Loss of notification context
--   - Generic messages
--   - Potential cross-user confusion
-- 
-- SOLUTION:
--   1. Add metadata column if missing
--   2. Update process_notification_queue() to populate metadata with:
--      - event_type, entity_id, entity_type
--      - Original payload
--      - Explicit profissional_target (ownership tracking)
-- 
-- SAFETY:
--   ✅ CREATE OR REPLACE (no data loss)
--   ✅ Metadata default '{}' prevents NULL violations
--   ✅ Maintains all existing idempotency logic
--   ✅ No changes to deadline notifications (053 already correct)
-- 
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 1: Ensure schema has required columns
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Add metadata column if it doesn't exist
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN notifications.metadata IS 'Rich context for notification (entity details, source, profissional_target)';

-- Ensure read_at exists (should already exist from 005 migration)
ALTER TABLE notifications 
ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 2: Fix process_notification_queue function
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION process_notification_queue()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_size INT := 100;
    v_queue_record RECORD;
    v_admin_ids UUID[];
BEGIN
    -- Get active admins
    SELECT ARRAY_AGG(id) INTO v_admin_ids
    FROM profissionais
    WHERE role IN ('admin', 'manager', 'master')
      AND ativo = true;

    IF v_admin_ids IS NULL THEN
        RETURN;
    END IF;

    -- Process pending queue items with entity validation
    FOR v_queue_record IN
        SELECT *
        FROM notification_queue
        WHERE status = 'pending'
          AND entity_id IS NOT NULL      -- ✅ Defensive: only process valid entities
          AND entity_type IS NOT NULL    -- ✅ Defensive: only process valid entities
        ORDER BY created_at
        LIMIT v_batch_size
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            UPDATE notification_queue
            SET status = 'processing',
                retry_count = retry_count + 1
            WHERE id = v_queue_record.id;

            -- Insert notifications with FULL CONTEXT
            IF v_queue_record.event_type IN ('macro_completed', 'micro_completed', 'micro_returned') THEN
                INSERT INTO notifications (
                    profissional_id,
                    type,
                    title,
                    message,
                    link,
                    entity_id,
                    entity_type,
                    metadata,        -- ✅ FIX: Added metadata field
                    read_at
                )
                SELECT
                    admin_id,
                    CASE v_queue_record.event_type
                        WHEN 'macro_completed' THEN 'macro_task_completed'
                        WHEN 'micro_completed' THEN 'micro_task_completed'
                        WHEN 'micro_returned' THEN 'micro_task_returned'
                    END,
                    v_queue_record.payload->>'title',
                    v_queue_record.payload->>'message',
                    v_queue_record.payload->>'link',
                    v_queue_record.entity_id,
                    v_queue_record.entity_type,
                    jsonb_build_object(                         -- ✅ FIX: Populate metadata
                        'event_type', v_queue_record.event_type,
                        'entity_id', v_queue_record.entity_id,
                        'entity_type', v_queue_record.entity_type,
                        'payload', v_queue_record.payload,
                        'profissional_target', admin_id,        -- ✅ Explicit owner tracking
                        'queued_at', v_queue_record.created_at
                    ),
                    NULL  -- read_at starts as NULL (unread)
                FROM UNNEST(v_admin_ids) AS admin_id
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM notifications n
                    WHERE n.entity_id = v_queue_record.entity_id
                      AND n.type = CASE v_queue_record.event_type
                            WHEN 'macro_completed' THEN 'macro_task_completed'
                            WHEN 'micro_completed' THEN 'micro_task_completed'
                            WHEN 'micro_returned' THEN 'micro_task_returned'
                      END
                      AND n.profissional_id = admin_id
                      AND n.created_at > NOW() - INTERVAL '1 hour'
                );
            END IF;

            UPDATE notification_queue
            SET status = 'completed',
                processed_at = NOW(),
                error = NULL
            WHERE id = v_queue_record.id;

        EXCEPTION WHEN OTHERS THEN
            UPDATE notification_queue
            SET status = 'failed',
                error = 'processing_error',
                processed_at = NOW()
            WHERE id = v_queue_record.id;
        END;
    END LOOP;
    
    -- Auto-cleanup old completed/failed items
    DELETE FROM notification_queue
    WHERE status IN ('completed', 'failed')
      AND processed_at < NOW() - INTERVAL '7 days';
END;
$$;

COMMENT ON FUNCTION process_notification_queue() IS 
'FIX 054: Restored metadata field to preserve full notification context and prevent cross-user confusion. Includes defensive entity validation.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VALIDATION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
BEGIN
    -- Verify function exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'process_notification_queue'
    ) THEN
        RAISE EXCEPTION 'Function creation failed';
    END IF;
    
    -- Verify metadata column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'notifications'
          AND column_name = 'metadata'
    ) THEN
        RAISE EXCEPTION 'Metadata column creation failed';
    END IF;
    
    RAISE NOTICE '✅ Migration 054 applied successfully';
    RAISE NOTICE '✅ Metadata column confirmed';
    RAISE NOTICE '✅ process_notification_queue() updated with context preservation';
END $$;

COMMIT;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION COMPLETE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- VERIFICATION QUERIES:
--
-- 1. Check metadata column:
--    SELECT column_name, data_type FROM information_schema.columns 
--    WHERE table_name = 'notifications' AND column_name = 'metadata';
--
-- 2. Test queue processor:
--    INSERT INTO notification_queue (event_type, entity_id, entity_type, payload)
--    VALUES ('macro_completed', gen_random_uuid(), 'macro_task', 
--            '{"title":"Test","message":"Validating metadata"}'::jsonb);
--    SELECT process_notification_queue();
--
-- 3. Verify notifications have metadata:
--    SELECT id, profissional_id, title, metadata 
--    FROM notifications 
--    WHERE title = 'Test' 
--    ORDER BY created_at DESC;
--
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
