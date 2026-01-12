-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration: Add SLA fields to tarefas_itens (PRODUCTION SAFE)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CRITICAL: This migration does NOT modify existing data
-- CRITICAL: All new fields are NULLABLE
-- CRITICAL: SLA only applies to NEW micro tasks
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Add SLA fields as NULLABLE (no impact on existing rows)
ALTER TABLE tarefas_itens 
  ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ NULL;

-- 2. Create indexes CONCURRENTLY (no table locks)
-- Only index rows where deadline_at is set (new micro tasks only)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tarefas_itens_deadline
ON tarefas_itens(deadline_at)
WHERE deadline_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tarefas_itens_started
ON tarefas_itens(started_at)
WHERE started_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tarefas_itens_finished
ON tarefas_itens(finished_at)
WHERE finished_at IS NOT NULL;

-- 3. Comments
COMMENT ON COLUMN tarefas_itens.deadline_at IS 
  'Prazo específico desta micro tarefa. NULL = sem SLA (micro tarefas antigas)';
COMMENT ON COLUMN tarefas_itens.started_at IS 
  'Timestamp quando status mudou para em_progresso. Preenchido automaticamente por trigger.';
COMMENT ON COLUMN tarefas_itens.finished_at IS 
  'Timestamp quando status mudou para concluida. Preenchido automaticamente por trigger.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VERIFICATION: No existing data was modified
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DO $$
DECLARE
    v_count_with_deadline INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count_with_deadline
    FROM tarefas_itens
    WHERE deadline_at IS NOT NULL;
    
    IF v_count_with_deadline > 0 THEN
        RAISE EXCEPTION 'CRITICAL: Migration modified existing data! Rollback immediately.';
    END IF;
    
    RAISE NOTICE '✅ Migration verified: 0 existing micro tasks were modified';
END $$;
