-- 1. Table for Detailed Worker Telemetry
CREATE TABLE IF NOT EXISTS ap.worker_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_name TEXT NOT NULL,
    worker_id UUID NOT NULL,
    cliente_id UUID,
    news_id UUID REFERENCES ap.candidate_news(id),
    action TEXT,
    status TEXT NOT NULL, -- 'start', 'success', 'error'
    duration_ms INTEGER,
    cost_usd NUMERIC(10, 6) DEFAULT 0,
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Indexes for fast aggregation
CREATE INDEX IF NOT EXISTS idx_telemetry_worker_status ON ap.worker_telemetry (worker_name, status, created_at);
CREATE INDEX IF NOT EXISTS idx_telemetry_news_id ON ap.worker_telemetry (news_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_created_at ON ap.worker_telemetry (created_at DESC);

-- 3. View for Real-time Pipeline Health (Backlog & Latency)
CREATE OR REPLACE VIEW ap.v_pipeline_health AS
SELECT 
    status,
    COUNT(*) as item_count,
    AVG(EXTRACT(EPOCH FROM (now() - updated_at))) / 60 as avg_wait_minutes
FROM ap.candidate_news
WHERE status != 'posted' AND status != 'failed' AND status != 'rejected'
GROUP BY status;

-- 4. View for Throughput (Items per Minute)
CREATE OR REPLACE VIEW ap.v_throughput AS
SELECT 
    worker_name,
    COUNT(*) as processed_last_hour,
    AVG(duration_ms) as avg_duration_ms,
    SUM(cost_usd) as total_cost_last_hour
FROM ap.worker_telemetry
WHERE status = 'success' AND created_at > now() - interval '1 hour'
GROUP BY worker_name;

-- 5. View for Cost per Tenant
CREATE OR REPLACE VIEW ap.v_cost_summary AS
SELECT 
    cliente_id,
    date_trunc('day', created_at) as day,
    SUM(cost_usd) as daily_cost
FROM ap.worker_telemetry
GROUP BY cliente_id, day;
;
