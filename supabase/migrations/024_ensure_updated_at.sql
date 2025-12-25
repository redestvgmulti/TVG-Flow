-- Ensure updated_at column exists in tarefas table
-- This is a safety migration in case 004_task_enrichment.sql was not applied

ALTER TABLE tarefas ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Ensure trigger exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_tarefas_updated_at ON tarefas;

CREATE TRIGGER trigger_update_tarefas_updated_at
BEFORE UPDATE ON tarefas
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
