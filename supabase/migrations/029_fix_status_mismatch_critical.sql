-- ============================================
-- MIGRATION: Fix Status Mismatch (P6 - CRITICAL)
-- Standardize all status values to Portuguese
-- ============================================

-- 1. Update existing data to Portuguese
UPDATE tarefas 
SET status = CASE 
    WHEN status = 'pending' THEN 'pendente'
    WHEN status = 'in_progress' THEN 'em_progresso'
    WHEN status = 'completed' THEN 'concluida'
    ELSE status
END
WHERE status IN ('pending', 'in_progress', 'completed');

UPDATE tarefas_itens
SET status = CASE
    WHEN status = 'pending' THEN 'pendente'
    WHEN status = 'completed' THEN 'concluida'
    ELSE status
END
WHERE status IN ('pending', 'completed');

-- 2. Drop old constraint
ALTER TABLE tarefas DROP CONSTRAINT IF EXISTS tarefas_status_check;

-- 3. Add new constraint with Portuguese values
ALTER TABLE tarefas ADD CONSTRAINT tarefas_status_check 
    CHECK (status IN ('pendente', 'em_progresso', 'concluida'));

-- 4. Update trigger function to use Portuguese
CREATE OR REPLACE FUNCTION update_tarefa_status_from_itens()
RETURNS TRIGGER AS $$
DECLARE
    total_itens INTEGER;
    concluidas_itens INTEGER;
    target_tarefa_id UUID;
BEGIN
    -- Determine which task to update
    target_tarefa_id := COALESCE(NEW.tarefa_id, OLD.tarefa_id);
    
    -- Count total and completed micro-tasks for this macro task
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'concluida')
    INTO total_itens, concluidas_itens
    FROM tarefas_itens
    WHERE tarefa_id = target_tarefa_id;
    
    -- If no micro-tasks exist, don't change macro task status
    IF total_itens = 0 THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    
    -- Update macro task status based on micro-task completion
    IF concluidas_itens = total_itens THEN
        -- All micro-tasks completed → macro task completed
        UPDATE tarefas
        SET status = 'concluida',
            updated_at = now()
        WHERE id = target_tarefa_id
        AND status != 'concluida';
        
    ELSIF concluidas_itens > 0 AND concluidas_itens < total_itens THEN
        -- Some completed → in progress
        UPDATE tarefas
        SET status = 'em_progresso',
            updated_at = now()
        WHERE id = target_tarefa_id
        AND status NOT IN ('em_progresso', 'concluida');
        
    ELSE
        -- None completed → pending
        UPDATE tarefas
        SET status = 'pendente',
            updated_at = now()
        WHERE id = target_tarefa_id
        AND status NOT IN ('pendente', 'em_progresso');
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 5. Verify constraint on tarefas_itens
ALTER TABLE tarefas_itens DROP CONSTRAINT IF EXISTS tarefas_itens_status_check;
ALTER TABLE tarefas_itens ADD CONSTRAINT tarefas_itens_status_check
    CHECK (status IN ('pendente', 'concluida'));

-- 6. Add comments for documentation
COMMENT ON CONSTRAINT tarefas_status_check ON tarefas IS 'Status values: pendente, em_progresso, concluida (Portuguese only)';
COMMENT ON CONSTRAINT tarefas_itens_status_check ON tarefas_itens IS 'Status values: pendente, concluida (Portuguese only)';
COMMENT ON FUNCTION update_tarefa_status_from_itens() IS 'Auto-updates macro task status based on micro-tasks completion (Portuguese status values)';
