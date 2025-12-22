-- Migration: Create tarefas_itens (micro-tasks) table
-- Description: Individual task items assigned to specific professionals for collaborative task execution

CREATE TABLE IF NOT EXISTS tarefas_itens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tarefa_id UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
    profissional_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente', 'concluida')),
    entrega_link TEXT,
    observacoes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    concluida_at TIMESTAMP WITH TIME ZONE,
    
    -- Prevent duplicate assignments (one professional can't have multiple items for same task)
    UNIQUE(tarefa_id, profissional_id)
);

-- Indexes for performance
CREATE INDEX idx_tarefas_itens_tarefa ON tarefas_itens(tarefa_id);
CREATE INDEX idx_tarefas_itens_profissional ON tarefas_itens(profissional_id);
CREATE INDEX idx_tarefas_itens_status ON tarefas_itens(status);

-- Trigger for updated_at
CREATE TRIGGER update_tarefas_itens_updated_at
    BEFORE UPDATE ON tarefas_itens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger to automatically set concluida_at timestamp
CREATE OR REPLACE FUNCTION set_tarefas_itens_concluida_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'concluida' AND (OLD.status IS NULL OR OLD.status != 'concluida') THEN
        NEW.concluida_at = now();
    ELSIF NEW.status = 'pendente' AND OLD.status = 'concluida' THEN
        NEW.concluida_at = NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_tarefas_itens_concluida_at
    BEFORE UPDATE ON tarefas_itens
    FOR EACH ROW
    EXECUTE FUNCTION set_tarefas_itens_concluida_at();

-- Business Logic Trigger: Auto-update macro task status based on micro-tasks
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
        SET status = 'completed',
            updated_at = now()
        WHERE id = target_tarefa_id
        AND status != 'completed';
        
    ELSIF concluidas_itens > 0 AND concluidas_itens < total_itens THEN
        -- Some completed → in progress
        UPDATE tarefas
        SET status = 'in_progress',
            updated_at = now()
        WHERE id = target_tarefa_id
        AND status NOT IN ('in_progress', 'completed');
        
    ELSE
        -- None completed → pending
        UPDATE tarefas
        SET status = 'pending',
            updated_at = now()
        WHERE id = target_tarefa_id
        AND status NOT IN ('pending', 'in_progress');
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_tarefa_status_after_item_change
    AFTER INSERT OR UPDATE OR DELETE ON tarefas_itens
    FOR EACH ROW
    EXECUTE FUNCTION update_tarefa_status_from_itens();

-- Enable RLS
ALTER TABLE tarefas_itens ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Admin full access
CREATE POLICY "Admin can manage all micro-tasks"
    ON tarefas_itens
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM usuarios
            WHERE usuarios.id = auth.uid()
            AND usuarios.tipo_perfil = 'admin'
        )
    );

-- RLS Policy: Professionals can view their micro-tasks
CREATE POLICY "Professionals can view their micro-tasks"
    ON tarefas_itens
    FOR SELECT
    TO authenticated
    USING (profissional_id = auth.uid());

-- RLS Policy: Professionals can update their micro-tasks
CREATE POLICY "Professionals can update their micro-tasks"
    ON tarefas_itens
    FOR UPDATE
    TO authenticated
    USING (profissional_id = auth.uid())
    WITH CHECK (profissional_id = auth.uid());

-- Comments
COMMENT ON TABLE tarefas_itens IS 'Micro-tasks assigned to individual professionals for collaborative task execution';
COMMENT ON COLUMN tarefas_itens.status IS 'Micro-task status: pendente or concluida';
COMMENT ON COLUMN tarefas_itens.entrega_link IS 'Link to deliverable (Google Drive, etc.)';
COMMENT ON COLUMN tarefas_itens.concluida_at IS 'Timestamp when micro-task was completed';
COMMENT ON FUNCTION update_tarefa_status_from_itens() IS 'Automatically updates macro task status based on micro-task completion';
