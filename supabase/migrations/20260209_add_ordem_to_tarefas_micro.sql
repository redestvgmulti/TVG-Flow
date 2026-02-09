-- Migration: Add ordem column to tarefas_micro for workflow ordering
-- Created: 2026-02-09
-- Purpose: Enable sequential workflow with ordered stages

-- Add ordem column to tarefas_micro
ALTER TABLE tarefas_micro
ADD COLUMN IF NOT EXISTS ordem INTEGER;

-- Add comment explaining the column
COMMENT ON COLUMN tarefas_micro.ordem IS 'Ordem sequencial da etapa no workflow (1, 2, 3...). NULL para tarefas antigas ou não-workflow.';

-- Create index for performance (ordem is frequently used in WHERE and ORDER BY)
CREATE INDEX IF NOT EXISTS idx_tarefas_micro_ordem 
ON tarefas_micro(ordem) 
WHERE ordem IS NOT NULL;

-- Create composite index for efficient workflow queries
-- (tarefa_id + ordem together are used to find previous/next stages)
CREATE INDEX IF NOT EXISTS idx_tarefas_micro_tarefa_ordem 
ON tarefas_micro(tarefa_id, ordem) 
WHERE ordem IS NOT NULL;

-- Optional: Add check constraint to ensure ordem is positive
ALTER TABLE tarefas_micro
ADD CONSTRAINT chk_tarefas_micro_ordem_positive 
CHECK (ordem IS NULL OR ordem > 0);

-- NOTES:
-- 1. ordem is NULLABLE to support:
--    - Legacy tasks created before workflow system
--    - Simple tasks without multi-stage workflow
-- 2. No default value - must be explicitly set when creating workflow tasks
-- 3. ordem is PER tarefa_id (not globally unique)
-- 4. Common usage pattern:
--    - Get previous stage: WHERE tarefa_id = X AND ordem < current_ordem ORDER BY ordem DESC LIMIT 1
--    - Get next stage: WHERE tarefa_id = X AND ordem > current_ordem ORDER BY ordem ASC LIMIT 1
