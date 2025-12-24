-- ============================================
-- MIGRATION: Overdue Tasks Detection System
-- Execute este SQL no Supabase SQL Editor
-- ============================================

-- 1. Create view for real-time overdue detection
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

-- 3. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tarefas_deadline ON tarefas(deadline);
CREATE INDEX IF NOT EXISTS idx_overdue_log_last_notified ON overdue_notifications_log(last_notified_at);

-- 4. Add comments
COMMENT ON VIEW tarefas_com_status_real IS 'Tasks with computed overdue status (derived, not persisted)';
COMMENT ON TABLE overdue_notifications_log IS 'Tracks last notification time to prevent hourly spam';

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check if view was created
SELECT COUNT(*) as total_tasks, 
       SUM(CASE WHEN is_overdue THEN 1 ELSE 0 END) as overdue_tasks
FROM tarefas_com_status_real;

-- Check if table was created
SELECT COUNT(*) FROM overdue_notifications_log;
