-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FlowOS Phase 3 — Async Notifications: Queue Table
-- Migration 047: Create notification_queue with idempotency support
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Queue table for async notification processing
CREATE TABLE IF NOT EXISTS notification_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'macro_completed',
        'micro_completed', 
        'micro_returned',
        'task_assigned'
    )),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('task', 'micro_task')),
    entity_id UUID NOT NULL,
    payload JSONB NOT NULL,  -- {title, message, link, profissional_ids (optional), etc}
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    processed_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending' NOT NULL CHECK (status IN (
        'pending',
        'processing', 
        'completed',
        'failed'
    )),
    error TEXT,
    retry_count INT DEFAULT 0,
    
    -- Metadata
    tenant_id UUID,  -- For future multi-tenancy filtering
    priority INT DEFAULT 0  -- For future prioritization (0 = normal)
);

-- Indexes for efficient processing
CREATE INDEX idx_notification_queue_pending 
ON notification_queue(created_at ASC) 
WHERE status = 'pending';

CREATE INDEX idx_notification_queue_status 
ON notification_queue(status, created_at ASC);

CREATE INDEX idx_notification_queue_cleanup 
ON notification_queue(processed_at) 
WHERE status IN ('completed', 'failed');

-- Idempotency: Prevent duplicate events in queue (recent window)
CREATE UNIQUE INDEX idx_notification_queue_unique_event
ON notification_queue(entity_id, event_type)
WHERE status IN ('pending', 'processing') 
  AND created_at > NOW() - INTERVAL '1 hour';

-- Comments
COMMENT ON TABLE notification_queue IS 'Async queue for notification processing via pg_cron. Prevents sync triggers from blocking transactions.';
COMMENT ON COLUMN notification_queue.payload IS 'JSONB payload with title, message, link, and optional profissional_ids array';
COMMENT ON COLUMN notification_queue.retry_count IS 'Number of processing retries (for future fault tolerance)';
COMMENT ON INDEX idx_notification_queue_unique_event IS 'Prevents duplicate events in active queue (1 hour window)';

-- Grant permissions (adjust based on your auth setup)
-- GRANT SELECT, INSERT ON notification_queue TO authenticated;
-- GRANT ALL ON notification_queue TO service_role;
