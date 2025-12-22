-- Migration: Add empresa_id to tarefas table
-- Description: Link tasks to companies for multi-company operations

-- Add empresa_id column
ALTER TABLE tarefas
ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL;

-- Create index for company-based task queries
CREATE INDEX IF NOT EXISTS idx_tarefas_empresa ON tarefas(empresa_id);

-- Comment
COMMENT ON COLUMN tarefas.empresa_id IS 'Company/client associated with this task';
