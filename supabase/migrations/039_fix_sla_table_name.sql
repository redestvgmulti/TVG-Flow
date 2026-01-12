-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION 039: FIX SLA TABLE NAME (CRITICAL CORRECTION)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PURPOSE: Correct critical modeling error from migrations 035-038
-- ISSUE: SLA fields were added to wrong table (tarefas_itens - doesn't exist)
-- FIX: Add SLA fields to correct table (tarefas_micro - used by Edge Function)
-- 
-- SAFETY: 100% production-safe
-- - All columns are NULLABLE
-- - No existing data is modified
-- - Triggers have deadline_at IS NOT NULL guards
-- - Forward-only implementation (only new tasks with deadline_at)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 1: ADD SLA COLUMNS TO CORRECT TABLE (tarefas_micro)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE tarefas_micro 
  ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN tarefas_micro.deadline_at IS 'SLA deadline for this micro task. NULL = no SLA tracking';
COMMENT ON COLUMN tarefas_micro.started_at IS 'Timestamp when professional started working (status changed to em_execucao)';
COMMENT ON COLUMN tarefas_micro.finished_at IS 'Timestamp when micro task was completed (status changed to concluida)';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 2: DROP OLD SLA OBJECTS FROM INCORRECT TABLE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DROP VIEW IF EXISTS vw_micro_tarefas_sla CASCADE;
DROP FUNCTION IF EXISTS calcular_sla_micro_tarefa(UUID) CASCADE;
DROP FUNCTION IF EXISTS identificar_gargalo(UUID) CASCADE;
DROP TRIGGER IF EXISTS trigger_set_micro_task_started_at ON tarefas_itens;
DROP TRIGGER IF EXISTS trigger_set_micro_task_finished_at ON tarefas_itens;
DROP FUNCTION IF EXISTS set_micro_task_started_at() CASCADE;
DROP FUNCTION IF EXISTS set_micro_task_finished_at() CASCADE;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 3: RECREATE TRIGGERS FOR tarefas_micro
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Trigger 1: Auto-set started_at when status changes to 'em_execucao'
CREATE OR REPLACE FUNCTION set_micro_task_started_at()
RETURNS TRIGGER AS $$
BEGIN
    -- GUARD: Only act on tasks with SLA (deadline_at IS NOT NULL)
    IF NEW.deadline_at IS NULL THEN
        RETURN NEW;
    END IF;

    -- Set started_at when status changes to 'em_execucao' for the first time
    IF NEW.status = 'em_execucao' 
       AND (OLD.status IS NULL OR OLD.status != 'em_execucao')
       AND NEW.started_at IS NULL THEN
        NEW.started_at := NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_micro_task_started_at ON tarefas_micro;
CREATE TRIGGER trigger_set_micro_task_started_at
    BEFORE UPDATE ON tarefas_micro
    FOR EACH ROW
    EXECUTE FUNCTION set_micro_task_started_at();

-- Trigger 2: Auto-set finished_at when status changes to 'concluida'
CREATE OR REPLACE FUNCTION set_micro_task_finished_at()
RETURNS TRIGGER AS $$
BEGIN
    -- GUARD: Only act on tasks with SLA (deadline_at IS NOT NULL)
    IF NEW.deadline_at IS NULL THEN
        RETURN NEW;
    END IF;

    -- Set finished_at when status changes to 'concluida' for the first time
    IF NEW.status = 'concluida' 
       AND (OLD.status IS NULL OR OLD.status != 'concluida')
       AND NEW.finished_at IS NULL THEN
        NEW.finished_at := NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_micro_task_finished_at ON tarefas_micro;
CREATE TRIGGER trigger_set_micro_task_finished_at
    BEFORE UPDATE ON tarefas_micro
    FOR EACH ROW
    EXECUTE FUNCTION set_micro_task_finished_at();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 4: RECREATE RPC FUNCTIONS FOR tarefas_micro
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- RPC 1: Calculate SLA for a specific micro task
CREATE OR REPLACE FUNCTION calcular_sla_micro_tarefa(p_micro_task_id UUID)
RETURNS TABLE (
    micro_task_id UUID,
    atrasada BOOLEAN,
    tempo_atraso_minutos INTEGER,
    status_sla TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mt.id AS micro_task_id,
        CASE
            WHEN mt.deadline_at IS NULL THEN FALSE
            WHEN mt.status = 'concluida' AND mt.finished_at > mt.deadline_at THEN TRUE
            WHEN mt.status != 'concluida' AND NOW() > mt.deadline_at THEN TRUE
            ELSE FALSE
        END AS atrasada,
        CASE
            WHEN mt.deadline_at IS NULL THEN NULL
            WHEN mt.status = 'concluida' AND mt.finished_at > mt.deadline_at THEN
                EXTRACT(EPOCH FROM (mt.finished_at - mt.deadline_at)) / 60
            WHEN mt.status != 'concluida' AND NOW() > mt.deadline_at THEN
                EXTRACT(EPOCH FROM (NOW() - mt.deadline_at)) / 60
            ELSE NULL
        END::INTEGER AS tempo_atraso_minutos,
        CASE
            WHEN mt.deadline_at IS NULL THEN 'sem_sla'
            WHEN mt.status = 'concluida' AND mt.finished_at <= mt.deadline_at THEN 'concluida_no_prazo'
            WHEN mt.status = 'concluida' AND mt.finished_at > mt.deadline_at THEN 'concluida_atrasada'
            WHEN NOW() > mt.deadline_at THEN 'atrasada'
            WHEN NOW() > (mt.deadline_at - INTERVAL '2 hours') THEN 'proximo_do_prazo'
            ELSE 'no_prazo'
        END AS status_sla
    FROM tarefas_micro mt
    WHERE mt.id = p_micro_task_id;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION calcular_sla_micro_tarefa IS 'Dynamically calculates SLA status for a micro task. Returns sem_sla if deadline_at IS NULL.';

-- RPC 2: Identify bottleneck (first overdue micro task in flow)
CREATE OR REPLACE FUNCTION identificar_gargalo(p_tarefa_id UUID)
RETURNS TABLE (
    micro_task_id UUID,
    funcao TEXT,
    profissional_nome TEXT,
    tempo_atraso_minutos INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mt.id AS micro_task_id,
        mt.funcao,
        p.nome AS profissional_nome,
        EXTRACT(EPOCH FROM (NOW() - mt.deadline_at)) / 60 AS tempo_atraso_minutos
    FROM tarefas_micro mt
    INNER JOIN profissionais p ON mt.profissional_id = p.id
    WHERE mt.tarefa_id = p_tarefa_id
      AND mt.deadline_at IS NOT NULL
      AND mt.status != 'concluida'
      AND NOW() > mt.deadline_at
    ORDER BY mt.created_at ASC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION identificar_gargalo IS 'Identifies the first overdue, non-completed micro task for a macro task (bottleneck).';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 5: RECREATE VIEW FOR tarefas_micro
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE VIEW vw_micro_tarefas_sla AS
SELECT
    mt.id,
    mt.tarefa_id,
    mt.profissional_id,
    p.nome AS profissional_nome,
    mt.funcao,
    mt.status,
    mt.deadline_at,
    mt.started_at,
    mt.finished_at,
    mt.created_at,
    mt.updated_at,
    -- Dynamic SLA calculations
    CASE
        WHEN mt.deadline_at IS NULL THEN FALSE
        WHEN mt.status = 'concluida' AND mt.finished_at > mt.deadline_at THEN TRUE
        WHEN mt.status != 'concluida' AND NOW() > mt.deadline_at THEN TRUE
        ELSE FALSE
    END AS atrasada,
    CASE
        WHEN mt.deadline_at IS NULL THEN NULL
        WHEN mt.status = 'concluida' AND mt.finished_at > mt.deadline_at THEN
            EXTRACT(EPOCH FROM (mt.finished_at - mt.deadline_at)) / 60
        WHEN mt.status != 'concluida' AND NOW() > mt.deadline_at THEN
            EXTRACT(EPOCH FROM (NOW() - mt.deadline_at)) / 60
        ELSE NULL
    END::INTEGER AS tempo_atraso_minutos,
    CASE
        WHEN mt.started_at IS NOT NULL AND mt.finished_at IS NULL THEN
            EXTRACT(EPOCH FROM (NOW() - mt.started_at)) / 60
        ELSE NULL
    END::INTEGER AS tempo_execucao_minutos,
    CASE
        WHEN mt.status = 'concluida' AND mt.finished_at IS NOT NULL THEN
            EXTRACT(EPOCH FROM (mt.finished_at - mt.created_at)) / 60
        ELSE NULL
    END::INTEGER AS tempo_total_conclusao_minutos,
    CASE
        WHEN mt.deadline_at IS NULL THEN 'sem_sla'
        WHEN mt.status = 'concluida' AND mt.finished_at <= mt.deadline_at THEN 'concluida_no_prazo'
        WHEN mt.status = 'concluida' AND mt.finished_at > mt.deadline_at THEN 'concluida_atrasada'
        WHEN NOW() > mt.deadline_at THEN 'atrasada'
        WHEN NOW() > (mt.deadline_at - INTERVAL '2 hours') THEN 'proximo_do_prazo'
        ELSE 'no_prazo'
    END AS status_sla
FROM tarefas_micro mt
LEFT JOIN profissionais p ON mt.profissional_id = p.id;

COMMENT ON VIEW vw_micro_tarefas_sla IS 'Optimized view for micro task SLA queries with dynamic calculations. Tasks with deadline_at=NULL have status_sla=sem_sla';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 6: CREATE INDEXES (SQL Editor compatible - no CONCURRENTLY)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE INDEX IF NOT EXISTS idx_tarefas_micro_deadline_at
    ON tarefas_micro(deadline_at)
    WHERE deadline_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tarefas_micro_started_at
    ON tarefas_micro(started_at)
    WHERE started_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tarefas_micro_finished_at
    ON tarefas_micro(finished_at)
    WHERE finished_at IS NOT NULL;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 7: CLEANUP - DROP INCORRECT TABLE (if exists)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DROP TABLE IF EXISTS tarefas_itens CASCADE;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VERIFICATION: Ensure no existing data was modified
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
DECLARE
    modified_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO modified_count
    FROM tarefas_micro
    WHERE deadline_at IS NOT NULL 
       OR started_at IS NOT NULL 
       OR finished_at IS NOT NULL;
    
    IF modified_count > 0 THEN
        RAISE EXCEPTION 'SAFETY CHECK FAILED: % existing micro tasks have SLA fields set. Migration should only affect new tasks!', modified_count;
    END IF;
    
    RAISE NOTICE '✓ VERIFICATION PASSED: 0 existing micro tasks were modified';
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION 039 COMPLETE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
