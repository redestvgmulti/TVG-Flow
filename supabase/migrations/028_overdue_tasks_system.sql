-- Migration: Overdue Tasks Detection System
-- Description: Adds automatic overdue status detection for tasks
-- IMPORTANT: Overdue is a DERIVED state, not a persisted status

-- 1. Create view (NOT materialized) for real-time overdue detection
CREATE OR REPLACE VIEW tarefas_com_status_real AS
SELECT
    t.*,
    (NOW() > t.deadline AND t.status <> 'concluida') AS is_overdue,
    CASE 
        WHEN NOW() > t.deadline AND t.status <> 'concluida' THEN 
            EXTRACT(EPOCH FROM (NOW() - t.deadline)) / 3600
        ELSE 0
    END as hours_overdue
FROM tarefas t;

-- 2. Create notification log to prevent spam
CREATE TABLE IF NOT EXISTS overdue_notifications_log (
    tarefa_id UUID PRIMARY KEY REFERENCES tarefas(id) ON DELETE CASCADE,
    last_notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create index on deadline for performance
CREATE INDEX IF NOT EXISTS idx_tarefas_deadline ON tarefas(deadline);
CREATE INDEX IF NOT EXISTS idx_overdue_log_last_notified ON overdue_notifications_log(last_notified_at);

-- 4. Comments
COMMENT ON VIEW tarefas_com_status_real IS 'Tasks with computed overdue status (derived, not persisted)';
COMMENT ON TABLE overdue_notifications_log IS 'Tracks last notification time to prevent hourly spam';

