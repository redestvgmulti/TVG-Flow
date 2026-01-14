-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FlowOS Phase 3 — Async Notifications: Queue Processor
-- Migration 049: Create queue processor function with idempotency
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MUST-1: SECURITY DEFINER + search_path (from approval document)
-- MUST-2: Idempotency via UNIQUE constraint (from approval document)
-- SHOULD-1: Cache admins per batch (from approval document)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Step 1: Add UNIQUE constraint to notifications for idempotency
-- Prevents duplicate notifications for same event within 24h window
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unique_event
ON notifications(entity_id, type, profissional_id)
WHERE created_at > NOW() - INTERVAL '24 hours';

COMMENT ON INDEX idx_notifications_unique_event IS 'Prevents duplicate notifications for same event within 24h (idempotency guarantee)';

-- Step 2: Queue Processor Function
CREATE OR REPLACE FUNCTION process_notification_queue()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER  -- MUST-1: Required for pg_cron execution
SET search_path = public  -- MUST-1: Explicit schema to prevent escalation
AS $$
DECLARE
    v_batch_size INT := 100;
    v_processed INT := 0;
    v_failed INT := 0;
    v_queue_record RECORD;
    v_admin_ids UUID[];  -- SHOULD-1: Cache admin IDs per batch
    v_start_time TIMESTAMPTZ := NOW();
BEGIN
    -- SHOULD-1: Fetch admin IDs once per batch (performance optimization)
    SELECT ARRAY_AGG(id) INTO v_admin_ids
    FROM profissionais
    WHERE role IN ('admin', 'manager', 'master')
      AND ativo = true;

    IF v_admin_ids IS NULL OR array_length(v_admin_ids, 1) = 0 THEN
        RAISE WARNING 'No active admins found for notifications';
        RETURN;
    END IF;

    -- Process pending items (FIFO, with lock)
    FOR v_queue_record IN
        SELECT * FROM notification_queue
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT v_batch_size
        FOR UPDATE SKIP LOCKED  -- Prevent concurrent processing
    LOOP
        BEGIN
            -- Mark as processing
            UPDATE notification_queue 
            SET status = 'processing',
                retry_count = retry_count + 1
            WHERE id = v_queue_record.id;

            -- Insert notifications based on event type
            -- MUST-2: ON CONFLICT DO NOTHING for idempotency
            IF v_queue_record.event_type = 'macro_completed' THEN
                INSERT INTO notifications (
                    profissional_id, 
                    type, 
                    title, 
                    message, 
                    link, 
                    entity_id, 
                    entity_type, 
                    read
                )
                SELECT 
                    UNNEST(v_admin_ids),
                    'macro_task_completed',
                    v_queue_record.payload->>'title',
                    v_queue_record.payload->>'message',
                    v_queue_record.payload->>'link',
                    v_queue_record.entity_id,
                    v_queue_record.entity_type,
                    false
                ON CONFLICT (entity_id, type, profissional_id) 
                WHERE created_at > NOW() - INTERVAL '24 hours'
                DO NOTHING;  -- MUST-2: Idempotency guarantee

            ELSIF v_queue_record.event_type = 'micro_completed' THEN
                INSERT INTO notifications (
                    profissional_id, 
                    type, 
                    title, 
                    message, 
                    link, 
                    entity_id, 
                    entity_type, 
                    read
                )
                SELECT 
                    UNNEST(v_admin_ids),
                    'micro_task_completed',
                    v_queue_record.payload->>'title',
                    v_queue_record.payload->>'message',
                    v_queue_record.payload->>'link',
                    v_queue_record.entity_id,
                    v_queue_record.entity_type,
                    false
                ON CONFLICT (entity_id, type, profissional_id) 
                WHERE created_at > NOW() - INTERVAL '24 hours'
                DO NOTHING;

            ELSIF v_queue_record.event_type = 'micro_returned' THEN
                INSERT INTO notifications (
                    profissional_id, 
                    type, 
                    title, 
                    message, 
                    link, 
                    entity_id, 
                    entity_type, 
                    read
                )
                SELECT 
                    UNNEST(v_admin_ids),
                    'micro_task_returned',
                    v_queue_record.payload->>'title',
                    v_queue_record.payload->>'message',
                    v_queue_record.payload->>'link',
                    v_queue_record.entity_id,
                    v_queue_record.entity_type,
                    false
                ON CONFLICT (entity_id, type, profissional_id) 
                WHERE created_at > NOW() - INTERVAL '24 hours'
                DO NOTHING;

            ELSIF v_queue_record.event_type = 'task_assigned' THEN
                -- Single user notification (not broadcast to admins)
                INSERT INTO notifications (
                    profissional_id, 
                    type, 
                    title, 
                    message, 
                    link, 
                    entity_id, 
                    entity_type, 
                    read
                )
                VALUES (
                    (v_queue_record.payload->>'profissional_id')::UUID,
                    'task_assigned',
                    v_queue_record.payload->>'title',
                    v_queue_record.payload->>'message',
                    v_queue_record.payload->>'link',
                    v_queue_record.entity_id,
                    v_queue_record.entity_type,
                    false
                )
                ON CONFLICT (entity_id, type, profissional_id) 
                WHERE created_at > NOW() - INTERVAL '24 hours'
                DO NOTHING;
            END IF;

            -- Mark as completed
            UPDATE notification_queue 
            SET status = 'completed', 
                processed_at = NOW(),
                error = NULL
            WHERE id = v_queue_record.id;

            v_processed := v_processed + 1;

        EXCEPTION WHEN OTHERS THEN
            -- Mark as failed with error, but don't stop processing
            UPDATE notification_queue 
            SET status = 'failed', 
                error = SQLERRM, 
                processed_at = NOW()
            WHERE id = v_queue_record.id;
            
            v_failed := v_failed + 1;
            
            RAISE WARNING 'Failed to process queue item %: %', v_queue_record.id, SQLERRM;
        END;
    END LOOP;

    -- MUST-3: Auto-cleanup old completed/failed items (from approval document)
    DELETE FROM notification_queue
    WHERE status IN ('completed', 'failed')
      AND processed_at < NOW() - INTERVAL '7 days';

    -- Log processing summary
    IF v_processed > 0 OR v_failed > 0 THEN
        RAISE NOTICE 'Notification queue processed: % succeeded, % failed in % ms', 
            v_processed, 
            v_failed,
            EXTRACT(EPOCH FROM (NOW() - v_start_time)) * 1000;
    END IF;
END;
$$;

COMMENT ON FUNCTION process_notification_queue IS 'Async processor for notification_queue. Runs via pg_cron every 30s. Includes idempotency, admin caching, and auto-cleanup.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Health Monitoring View (SHOULD-2: Backlog metrics)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE VIEW vw_notification_queue_health AS
SELECT 
    status,
    COUNT(*) as count,
    MIN(created_at) as oldest,
    MAX(created_at) as newest,
    EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::INT as oldest_age_seconds,
    CASE 
        WHEN status = 'pending' AND EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) > 300 
        THEN '🔴 CRITICAL: Backlog > 5min'
        WHEN status = 'pending' AND COUNT(*) > 1000 
        THEN '🟠 WARNING: Queue depth > 1000'
        WHEN status = 'pending' AND COUNT(*) > 100 
        THEN '🟡 CAUTION: Queue depth > 100'
        ELSE '✅ OK'
    END as health_status
FROM notification_queue
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY status
ORDER BY status;

COMMENT ON VIEW vw_notification_queue_health IS 'Monitor notification queue health (last 1 hour) with automatic alerting thresholds';
