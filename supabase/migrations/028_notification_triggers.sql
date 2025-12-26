-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Notification Triggers for Admin/Managers
-- Migration 028: Add triggers for Macro Completion, Micro Completion, and Devolution
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Helper Function to Notify Admins and Managers
-- Ensure link column exists
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;

CREATE OR REPLACE FUNCTION notify_admins_and_managers(
    p_title TEXT,
    p_message TEXT,
    p_link TEXT,
    p_type TEXT,
    p_entity_id UUID
)
RETURNS VOID AS $$
BEGIN
    -- Insert notification for all active admins and managers
    INSERT INTO notifications (profissional_id, type, title, message, link, entity_id, entity_type, read)
    SELECT 
        id,
        p_type,
        p_title,
        p_message,
        p_link,
        p_entity_id,
        'task',
        false
    FROM profissionais
    WHERE role IN ('admin', 'manager', 'master') -- inclusive list
    AND ativo = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Trigger: Macro Task Completion
CREATE OR REPLACE FUNCTION trigger_notify_macro_completion()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'concluida' AND (OLD IS NULL OR OLD.status != 'concluida') THEN
        PERFORM notify_admins_and_managers(
            'Tarefa Concluída',
            'A tarefa macro "' || NEW.titulo || '" foi concluída.',
            '/admin/tasks', -- Link to admin tasks
            'macro_task_completed',
            NEW.id
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_macro_completion ON tarefas;
CREATE TRIGGER trg_notify_macro_completion
    AFTER UPDATE ON tarefas
    FOR EACH ROW
    EXECUTE FUNCTION trigger_notify_macro_completion();

-- 3. Trigger: Micro Task Completion (Notify Admin)
CREATE OR REPLACE FUNCTION trigger_notify_micro_completion_admin()
RETURNS TRIGGER AS $$
DECLARE
    task_title TEXT;
    professional_name TEXT;
BEGIN
    IF NEW.status = 'concluida' AND (OLD IS NULL OR OLD.status != 'concluida') THEN
        -- Get Task Title
        SELECT titulo INTO task_title FROM tarefas WHERE id = NEW.tarefa_id;
        -- Get Professional Name
        SELECT nome INTO professional_name FROM profissionais WHERE id = NEW.profissional_id;

        PERFORM notify_admins_and_managers(
            'Etapa Concluída',
            'A etapa "' || NEW.funcao || '" foi concluída por ' || professional_name || ' na tarefa "' || task_title || '".',
            '/admin/tasks',
            'micro_task_completed',
            NEW.id
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_micro_completion_admin ON tarefas_micro;
CREATE TRIGGER trg_notify_micro_completion_admin
    AFTER UPDATE ON tarefas_micro
    FOR EACH ROW
    EXECUTE FUNCTION trigger_notify_micro_completion_admin();

-- 4. Trigger: Micro Task Devolution (Notify Admin)
CREATE OR REPLACE FUNCTION trigger_notify_micro_devolution_admin()
RETURNS TRIGGER AS $$
DECLARE
    task_title TEXT;
    reason TEXT;
BEGIN
    IF NEW.status = 'devolvida' AND (OLD IS NULL OR OLD.status != 'devolvida') THEN
        -- Get Task Title
        SELECT titulo INTO task_title FROM tarefas WHERE id = NEW.tarefa_id;
        
        -- Get Reason from logs (most recent returned log for this micro_task)
        SELECT motivo INTO reason 
        FROM tarefas_micro_logs 
        WHERE tarefa_micro_id = NEW.id 
        AND acao = 'returned' 
        ORDER BY created_at DESC 
        LIMIT 1;

        PERFORM notify_admins_and_managers(
            'Etapa Devolvida',
            'A etapa "' || NEW.funcao || '" foi devolvida na tarefa "' || task_title || '". Motivo: ' || COALESCE(reason, 'Não informado'),
            '/admin/tasks',
            'micro_task_returned',
            NEW.id
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_micro_devolution_admin ON tarefas_micro;
CREATE TRIGGER trg_notify_micro_devolution_admin
    AFTER UPDATE ON tarefas_micro
    FOR EACH ROW
    EXECUTE FUNCTION trigger_notify_micro_devolution_admin();
