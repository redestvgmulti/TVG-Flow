-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MACRO/MICRO TASK ORCHESTRATION SYSTEM
-- Migration 023: Create micro tasks tables, triggers, and indexes
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. CREATE TABLES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Micro Tasks Table
-- Stores individual workflow stages with dependencies and weights
CREATE TABLE IF NOT EXISTS tarefas_micro (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tarefa_id UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
    profissional_id UUID NOT NULL REFERENCES profissionais(id),
    funcao TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente' 
        CHECK (status IN ('pendente', 'bloqueada', 'em_execucao', 'concluida', 'devolvida')),
    peso INTEGER NOT NULL DEFAULT 1 CHECK (peso > 0),
    depends_on UUID REFERENCES tarefas_micro(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Micro Tasks Audit Log
-- Complete audit trail for all micro task actions
CREATE TABLE IF NOT EXISTS tarefas_micro_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tarefa_micro_id UUID NOT NULL REFERENCES tarefas_micro(id) ON DELETE CASCADE,
    from_profissional_id UUID REFERENCES profissionais(id),
    to_profissional_id UUID REFERENCES profissionais(id),
    acao TEXT NOT NULL CHECK (acao IN ('created', 'started', 'completed', 'returned', 'blocked', 'unblocked')),
    motivo TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. CREATE INDEXES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE INDEX idx_tarefas_micro_tarefa_id ON tarefas_micro(tarefa_id);
CREATE INDEX idx_tarefas_micro_profissional_id ON tarefas_micro(profissional_id);
CREATE INDEX idx_tarefas_micro_status ON tarefas_micro(status);
CREATE INDEX idx_tarefas_micro_depends_on ON tarefas_micro(depends_on);
CREATE INDEX idx_tarefas_micro_logs_tarefa_micro_id ON tarefas_micro_logs(tarefa_micro_id);
CREATE INDEX idx_tarefas_micro_logs_created_at ON tarefas_micro_logs(created_at DESC);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. CREATE TRIGGERS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Trigger 1: Auto-calculate weighted macro task progress
CREATE OR REPLACE FUNCTION update_macro_task_progress()
RETURNS TRIGGER AS $$
DECLARE
    total_weight INTEGER;
    completed_weight INTEGER;
    new_progress INTEGER;
    macro_task_id UUID;
BEGIN
    -- Get the macro task ID
    macro_task_id := COALESCE(NEW.tarefa_id, OLD.tarefa_id);
    
    -- Calculate total and completed weights
    SELECT 
        COALESCE(SUM(peso), 0),
        COALESCE(SUM(CASE WHEN status = 'concluida' THEN peso ELSE 0 END), 0)
    INTO total_weight, completed_weight
    FROM tarefas_micro
    WHERE tarefa_id = macro_task_id;
    
    -- Calculate progress percentage
    IF total_weight > 0 THEN
        new_progress := (completed_weight * 100) / total_weight;
    ELSE
        new_progress := 0;
    END IF;
    
    -- Update macro task
    UPDATE tarefas 
    SET progress = new_progress,
        updated_at = NOW()
    WHERE id = macro_task_id;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Apply trigger on INSERT, UPDATE, DELETE
DROP TRIGGER IF EXISTS trigger_update_macro_progress ON tarefas_micro;
CREATE TRIGGER trigger_update_macro_progress
    AFTER INSERT OR UPDATE OR DELETE ON tarefas_micro
    FOR EACH ROW
    EXECUTE FUNCTION update_macro_task_progress();

-- Trigger 2: Auto-complete macro task when all micro tasks are done
CREATE OR REPLACE FUNCTION check_macro_task_completion()
RETURNS TRIGGER AS $$
DECLARE
    incomplete_count INTEGER;
BEGIN
    -- Only check if the micro task was just completed
    IF NEW.status = 'concluida' AND (OLD IS NULL OR OLD.status != 'concluida') THEN
        -- Count incomplete micro tasks
        SELECT COUNT(*) INTO incomplete_count
        FROM tarefas_micro
        WHERE tarefa_id = NEW.tarefa_id
        AND status != 'concluida';
        
        -- If all micro tasks are complete, mark macro task as complete
        IF incomplete_count = 0 THEN
            -- Update macro task status
            UPDATE tarefas
            SET status = 'concluida',
                updated_at = NOW()
            WHERE id = NEW.tarefa_id;
            
            -- Note: Notifications will be handled by Edge Function
            -- to avoid dependency on usuarios table structure
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger on UPDATE only
DROP TRIGGER IF EXISTS trigger_check_macro_completion ON tarefas_micro;
CREATE TRIGGER trigger_check_macro_completion
    AFTER UPDATE ON tarefas_micro
    FOR EACH ROW
    EXECUTE FUNCTION check_macro_task_completion();

-- Trigger 3: Auto-block/unblock dependent tasks
CREATE OR REPLACE FUNCTION update_dependent_tasks()
RETURNS TRIGGER AS $$
BEGIN
    -- If a micro task is completed, unblock dependent tasks
    IF NEW.status = 'concluida' AND (OLD IS NULL OR OLD.status != 'concluida') THEN
        UPDATE tarefas_micro
        SET status = 'pendente',
            updated_at = NOW()
        WHERE depends_on = NEW.id
        AND status = 'bloqueada';
        
        -- Log unblock action
        INSERT INTO tarefas_micro_logs (tarefa_micro_id, acao, from_profissional_id)
        SELECT id, 'unblocked', NEW.profissional_id
        FROM tarefas_micro
        WHERE depends_on = NEW.id
        AND status = 'pendente';
    END IF;
    
    -- If a completed micro task is reopened, block dependent tasks
    IF OLD IS NOT NULL AND OLD.status = 'concluida' AND NEW.status != 'concluida' THEN
        UPDATE tarefas_micro
        SET status = 'bloqueada',
            updated_at = NOW()
        WHERE depends_on = NEW.id
        AND status IN ('pendente', 'em_execucao');
        
        -- Log block action
        INSERT INTO tarefas_micro_logs (tarefa_micro_id, acao, from_profissional_id)
        SELECT id, 'blocked', NEW.profissional_id
        FROM tarefas_micro
        WHERE depends_on = NEW.id
        AND status = 'bloqueada';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger on UPDATE only
DROP TRIGGER IF EXISTS trigger_update_dependent_tasks ON tarefas_micro;
CREATE TRIGGER trigger_update_dependent_tasks
    AFTER UPDATE ON tarefas_micro
    FOR EACH ROW
    EXECUTE FUNCTION update_dependent_tasks();

-- Trigger 4: Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_tarefas_micro_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_tarefas_micro_updated_at ON tarefas_micro;
CREATE TRIGGER trigger_tarefas_micro_updated_at
    BEFORE UPDATE ON tarefas_micro
    FOR EACH ROW
    EXECUTE FUNCTION update_tarefas_micro_timestamp();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. ADD PROGRESS COLUMN TO TAREFAS (IF NOT EXISTS)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tarefas' AND column_name = 'progress'
    ) THEN
        ALTER TABLE tarefas ADD COLUMN progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100);
    END IF;
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. ENABLE RLS (Row Level Security)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE tarefas_micro ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarefas_micro_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Professionals can view their own micro tasks
CREATE POLICY "Professionals view own micro tasks"
    ON tarefas_micro FOR SELECT
    USING (
        profissional_id = auth.uid()
    );

-- Policy: Professionals can update their own micro tasks
CREATE POLICY "Professionals update own micro tasks"
    ON tarefas_micro FOR UPDATE
    USING (
        profissional_id = auth.uid()
    );

-- Policy: Service role can insert micro tasks (via Edge Functions)
CREATE POLICY "Service role creates micro tasks"
    ON tarefas_micro FOR INSERT
    WITH CHECK (true);

-- Policy: Professionals can view logs for their micro tasks
CREATE POLICY "Professionals view own micro task logs"
    ON tarefas_micro_logs FOR SELECT
    USING (
        tarefa_micro_id IN (
            SELECT id FROM tarefas_micro WHERE profissional_id = auth.uid()
        )
    );

-- Policy: Service role can insert logs
CREATE POLICY "Service role creates logs"
    ON tarefas_micro_logs FOR INSERT
    WITH CHECK (true);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION COMPLETE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
