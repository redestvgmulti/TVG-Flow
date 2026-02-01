-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FlowOS Phase 3 — Security Hardening: Sanitized Queue Processor
-- Migration 052: Remove ALL sensitive logging from process_notification_queue
-- SAFE: CREATE OR REPLACE (no data loss, atomic replacement)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION process_notification_queue()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_size INT := 100;
    v_processed INT := 0;
    v_queue_record RECORD;
    v_admin_ids UUID[];
BEGIN
    -- Get active admins (no logging)
    SELECT ARRAY_AGG(id) INTO v_admin_ids
    FROM profissionais
    WHERE role IN ('admin', 'manager', 'master') AND ativo = true;

    IF v_admin_ids IS NULL OR array_length(v_admin_ids, 1) = 0 THEN
        RETURN;
    END IF;

    FOR v_queue_record IN
        SELECT * FROM notification_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT v_batch_size
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            UPDATE notification_queue 
            SET status = 'processing', retry_count = retry_count + 1
            WHERE id = v_queue_record.id;

            IF v_queue_record.event_type IN ('macro_completed', 'micro_completed', 'micro_returned') THEN
                INSERT INTO notifications (profissional_id, type, title, message, link, entity_id, entity_type, read)
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
                    false
                FROM UNNEST(v_admin_ids) AS admin_id
                WHERE NOT EXISTS (
                    SELECT 1 FROM notifications n
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
            SET status = 'completed', processed_at = NOW(), error = NULL
            WHERE id = v_queue_record.id;

            v_processed := v_processed + 1;

        EXCEPTION WHEN OTHERS THEN
            -- SECURE: Generic error only, no SQLERRM, no IDs
            UPDATE notification_queue 
            SET status = 'failed', 
                error = 'processing_error',
                processed_at = NOW()
            WHERE id = v_queue_record.id;
        END;
    END LOOP;

    -- Auto-cleanup (no logging)
    DELETE FROM notification_queue
    WHERE status IN ('completed', 'failed')
      AND processed_at < NOW() - INTERVAL '7 days';

    -- NO LOGGING (removed all RAISE NOTICE/WARNING)
END;
$$;

COMMENT ON FUNCTION process_notification_queue() IS 'HARDENED: Zero sensitive data logging. Processes notification queue with idempotency and auto-cleanup.';

-- Validation (silent, no output)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc 
        WHERE proname = 'process_notification_queue'
    ) THEN
        RAISE EXCEPTION 'Function creation failed';
    END IF;
END $$;
