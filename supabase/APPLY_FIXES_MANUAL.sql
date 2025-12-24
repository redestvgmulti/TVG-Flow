-- ============================================
-- CORREÇÕES CRÍTICAS - TVG FLOW
-- Execute este SQL completo no Supabase SQL Editor
-- ============================================

-- ============================================
-- PARTE 1: FIX STATUS MISMATCH (P6 - CRÍTICO)
-- ============================================

-- 1. Atualizar dados existentes para português
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

-- 2. Atualizar constraints
ALTER TABLE tarefas DROP CONSTRAINT IF EXISTS tarefas_status_check;
ALTER TABLE tarefas ADD CONSTRAINT tarefas_status_check 
    CHECK (status IN ('pendente', 'em_progresso', 'concluida'));

ALTER TABLE tarefas_itens DROP CONSTRAINT IF EXISTS tarefas_itens_status_check;
ALTER TABLE tarefas_itens ADD CONSTRAINT tarefas_itens_status_check
    CHECK (status IN ('pendente', 'concluida'));

-- 3. Atualizar trigger function para usar português
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

-- ============================================
-- PARTE 2: ADD CONCLUIDA_AT COLUMN
-- ============================================

-- Adicionar coluna concluida_at se não existir
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tarefas' AND column_name = 'concluida_at'
    ) THEN
        ALTER TABLE tarefas ADD COLUMN concluida_at TIMESTAMPTZ;
        COMMENT ON COLUMN tarefas.concluida_at IS 'Timestamp when task was completed';
    END IF;
END $$;

-- Criar trigger para set concluida_at automaticamente
CREATE OR REPLACE FUNCTION set_tarefas_concluida_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'concluida' AND (OLD.status IS NULL OR OLD.status != 'concluida') THEN
        NEW.concluida_at = now();
    ELSIF NEW.status != 'concluida' AND OLD.status = 'concluida' THEN
        NEW.concluida_at = NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_tarefas_concluida_at ON tarefas;
CREATE TRIGGER trigger_set_tarefas_concluida_at
    BEFORE UPDATE ON tarefas
    FOR EACH ROW
    EXECUTE FUNCTION set_tarefas_concluida_at();

-- ============================================
-- PARTE 3: COMMENTS E DOCUMENTAÇÃO
-- ============================================

COMMENT ON CONSTRAINT tarefas_status_check ON tarefas IS 'Status values: pendente, em_progresso, concluida (Portuguese only)';
COMMENT ON CONSTRAINT tarefas_itens_status_check ON tarefas_itens IS 'Status values: pendente, concluida (Portuguese only)';
COMMENT ON FUNCTION update_tarefa_status_from_itens() IS 'Auto-updates macro task status based on micro-tasks completion (Portuguese status values)';

-- ============================================
-- VERIFICAÇÃO FINAL
-- ============================================

-- Verificar se tudo está correto
SELECT 
    'tarefas' as tabela,
    status,
    COUNT(*) as quantidade
FROM tarefas
GROUP BY status
ORDER BY status;

SELECT 
    'tarefas_itens' as tabela,
    status,
    COUNT(*) as quantidade
FROM tarefas_itens
GROUP BY status
ORDER BY status;

-- Verificar se coluna concluida_at existe
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'tarefas' 
AND column_name = 'concluida_at';

-- ============================================
-- SUCESSO!
-- Todas as correções críticas foram aplicadas
-- ============================================
