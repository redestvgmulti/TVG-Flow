-- Fix constraints really this time
-- Drop the constraint offending the error
ALTER TABLE tarefas_micro DROP CONSTRAINT IF EXISTS tarefas_micro_status_check;

-- Drop the one we might have created previously to avoid duplicates
ALTER TABLE tarefas_micro DROP CONSTRAINT IF EXISTS micro_status_check;

-- Re-create the standard constraint with correct Portuguese values
ALTER TABLE tarefas_micro 
ADD CONSTRAINT tarefas_micro_status_check 
CHECK (status IN ('pendente', 'em_progresso', 'concluida', 'bloqueada'));

-- Ensure data is consistent
UPDATE tarefas_micro 
SET status = 'pendente' 
WHERE status NOT IN ('pendente', 'em_progresso', 'concluida', 'bloqueada');
