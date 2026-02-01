-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Triggers para preencher timestamps de SLA
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CRITICAL: Only execute if deadline_at IS NOT NULL
-- CRITICAL: Do not affect legacy micro tasks (deadline_at = NULL)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Trigger para preencher started_at
CREATE OR REPLACE FUNCTION set_micro_task_started_at()
RETURNS TRIGGER AS $$
BEGIN
    -- 🔒 GUARDA: Só executa se deadline_at existir (micro tarefa com SLA)
    IF NEW.deadline_at IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Se mudou para em_progresso e ainda não tem started_at
    IF NEW.status = 'em_progresso' 
       AND (OLD.status IS NULL OR OLD.status = 'pendente')
       AND NEW.started_at IS NULL THEN
        NEW.started_at = now();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_micro_task_started_at ON tarefas_itens;
CREATE TRIGGER trigger_set_micro_task_started_at
    BEFORE UPDATE ON tarefas_itens
    FOR EACH ROW
    EXECUTE FUNCTION set_micro_task_started_at();

-- Trigger para preencher finished_at
CREATE OR REPLACE FUNCTION set_micro_task_finished_at()
RETURNS TRIGGER AS $$
BEGIN
    -- 🔒 GUARDA: Só executa se deadline_at existir (micro tarefa com SLA)
    IF NEW.deadline_at IS NULL THEN
        RETURN NEW;
    END IF;
    
    -- Se mudou para concluida
    IF NEW.status = 'concluida' 
       AND (OLD.status IS NULL OR OLD.status != 'concluida') THEN
        NEW.finished_at = now();
        
    -- Se reabriu (mudou de concluida para outro status)
    ELSIF NEW.status != 'concluida' AND OLD.status = 'concluida' THEN
        NEW.finished_at = NULL;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_micro_task_finished_at ON tarefas_itens;
CREATE TRIGGER trigger_set_micro_task_finished_at
    BEFORE UPDATE ON tarefas_itens
    FOR EACH ROW
    EXECUTE FUNCTION set_micro_task_finished_at();

COMMENT ON FUNCTION set_micro_task_started_at() IS 
  'Preenche started_at quando status muda para em_progresso. Só executa se deadline_at IS NOT NULL.';
COMMENT ON FUNCTION set_micro_task_finished_at() IS 
  'Preenche finished_at quando status muda para concluida. Só executa se deadline_at IS NOT NULL.';
