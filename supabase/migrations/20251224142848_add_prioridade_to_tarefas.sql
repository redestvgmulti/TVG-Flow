-- Create ENUM type for task priority
CREATE TYPE prioridade_tarefa AS ENUM (
  'baixa',
  'normal',
  'alta',
  'urgente'
);

-- Add prioridade column to tarefas table
ALTER TABLE tarefas
ADD COLUMN prioridade prioridade_tarefa NOT NULL DEFAULT 'normal';

-- Create index for better query performance on priority filtering
CREATE INDEX idx_tarefas_prioridade ON tarefas(prioridade);

-- Comment for documentation
COMMENT ON COLUMN tarefas.prioridade IS 'Prioridade da tarefa: baixa, normal, alta, urgente';
