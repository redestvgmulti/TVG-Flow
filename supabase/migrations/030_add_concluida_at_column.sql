-- ============================================
-- MIGRATION: Add concluida_at column to tarefas
-- Required for proper completion tracking
-- ============================================

-- Add concluida_at column if it doesn't exist
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

-- Create trigger to set concluida_at automatically
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
