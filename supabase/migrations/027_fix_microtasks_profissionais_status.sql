-- Migration: Fix micro-tasks to use profissionais table and standardize status
-- Description: Corrects foreign key references and status values

-- 1. Drop existing foreign key constraint
ALTER TABLE tarefas_itens
DROP CONSTRAINT IF EXISTS tarefas_itens_profissional_id_fkey;

-- 2. Add correct foreign key to profissionais table
ALTER TABLE tarefas_itens
ADD CONSTRAINT tarefas_itens_profissional_id_fkey
FOREIGN KEY (profissional_id)
REFERENCES profissionais(id)
ON DELETE CASCADE;

-- 3. Update status check constraint to use pt-BR values
ALTER TABLE tarefas_itens
DROP CONSTRAINT IF EXISTS tarefas_itens_status_check;

ALTER TABLE tarefas_itens
ADD CONSTRAINT tarefas_itens_status_check
CHECK (status IN ('pendente', 'concluida'));

-- 4. Update existing status values to pt-BR (if any exist)
UPDATE tarefas_itens
SET status = 'pendente'
WHERE status IN ('pending', 'in_progress');

UPDATE tarefas_itens
SET status = 'concluida'
WHERE status = 'completed';

-- 5. Update tarefas status constraint as well
ALTER TABLE tarefas
DROP CONSTRAINT IF EXISTS tarefas_status_check;

ALTER TABLE tarefas
ADD CONSTRAINT tarefas_status_check
CHECK (status IN ('pendente', 'em_progresso', 'concluida'));

-- 6. Update existing tarefas status values
UPDATE tarefas
SET status = 'pendente'
WHERE status = 'pending';

UPDATE tarefas
SET status = 'em_progresso'
WHERE status = 'in_progress';

UPDATE tarefas
SET status = 'concluida'
WHERE status = 'completed';

-- 7. Update trigger function to use correct status values
CREATE OR REPLACE FUNCTION update_tarefa_status_from_itens()
RETURNS TRIGGER AS $$
DECLARE
    total_itens INTEGER;
    concluidas_itens INTEGER;
    target_tarefa_id UUID;
BEGIN
    target_tarefa_id := COALESCE(NEW.tarefa_id, OLD.tarefa_id);
    
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE status = 'concluida')
    INTO total_itens, concluidas_itens
    FROM tarefas_itens
    WHERE tarefa_id = target_tarefa_id;
    
    IF total_itens = 0 THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    
    IF concluidas_itens = total_itens THEN
        -- All completed
        UPDATE tarefas
        SET status = 'concluida',
            updated_at = now()
        WHERE id = target_tarefa_id
        AND status != 'concluida';
        
    ELSIF concluidas_itens > 0 AND concluidas_itens < total_itens THEN
        -- Some completed
        UPDATE tarefas
        SET status = 'em_progresso',
            updated_at = now()
        WHERE id = target_tarefa_id
        AND status NOT IN ('em_progresso', 'concluida');
        
    ELSE
        -- None completed
        UPDATE tarefas
        SET status = 'pendente',
            updated_at = now()
        WHERE id = target_tarefa_id
        AND status NOT IN ('pendente', 'em_progresso');
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON CONSTRAINT tarefas_itens_profissional_id_fkey ON tarefas_itens IS 'References profissionais table (operational data), not auth.users';
COMMENT ON CONSTRAINT tarefas_itens_status_check ON tarefas_itens IS 'Status in pt-BR: pendente or concluida';
COMMENT ON CONSTRAINT tarefas_status_check ON tarefas IS 'Status in pt-BR: pendente, em_progresso, or concluida';
