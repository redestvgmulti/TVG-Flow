-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: OPTIMIZE READ QUERIES (PERFORMANCE FASE 4)
-- Date: 2026-01-14
-- Description: Implement critical composite indexes for Dashboards and Notifications
--              to ensure < 100ms response time at scale.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. TASKS DASHBOARD (tarefas)
-- Query Pattern: WHERE empresa_id = ? AND status = ? ORDER BY deadline_at ASC
-- Target: Admin/Manager view filtering by company
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tarefas_empresa_status_deadline
ON tarefas (empresa_id, status, deadline_at ASC);

-- Secondary Sort Support (Created At)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tarefas_empresa_status_created
ON tarefas (empresa_id, status, created_at DESC);

-- 2. PROFESSIONAL DASHBOARD (tarefas_micro)
-- Query Pattern: WHERE profissional_id = ? AND status IN (...) ORDER BY deadline_at ASC
-- Target: Daily workload view for professionals
-- Note: 'deadline_at' was confirmed in migration 039
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tarefas_micro_prof_status_deadline
ON tarefas_micro (profissional_id, status, deadline_at ASC);

-- 3. NOTIFICATIONS (notificacoes)
-- Query Pattern: WHERE profissional_id = ? AND lida = false ORDER BY created_at DESC
-- Target: Notification bell/list
-- Optimization: Partial index for unread items (smaller, faster)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notificacoes_prof_unread_created
ON notificacoes (profissional_id, created_at DESC)
WHERE lida = false;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VERIFICATION LOG
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DO $$
BEGIN
    RAISE NOTICE '✅ Performance Indexes applied successfully.';
    RAISE NOTICE '   - idx_tarefas_empresa_status_deadline';
    RAISE NOTICE '   - idx_tarefas_micro_prof_status_deadline';
    RAISE NOTICE '   - idx_notificacoes_prof_unread_created';
END $$;
