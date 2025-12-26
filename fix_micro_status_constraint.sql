-- Fix micro_status_check constraint
-- Drop the old constraint and create a new one with correct values

ALTER TABLE tarefas_micro 
DROP CONSTRAINT IF EXISTS micro_status_check;

ALTER TABLE tarefas_micro 
ADD CONSTRAINT micro_status_check 
CHECK (status IN ('pendente', 'em_progresso', 'concluida', 'bloqueada'));

-- Update any invalid status values
UPDATE tarefas_micro 
SET status = 'pendente' 
WHERE status NOT IN ('pendente', 'em_progresso', 'concluida', 'bloqueada');
