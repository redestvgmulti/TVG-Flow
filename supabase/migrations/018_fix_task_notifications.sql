-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Fix: Notify on Task Creation (INSERT)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION notify_task_assignment()
RETURNS TRIGGER AS $$
BEGIN
  -- Handle INSERT: If new task has assignee
  IF (TG_OP = 'INSERT') THEN
    IF NEW.assigned_to IS NOT NULL THEN
       -- Check if assignee exists and is active
       IF EXISTS (SELECT 1 FROM profissionais WHERE id = NEW.assigned_to AND ativo = true) THEN
          INSERT INTO notifications (profissional_id, type, title, message, entity_type, entity_id)
          VALUES (
            NEW.assigned_to, 
            'task_assigned', 
            'Nova Tarefa', 
            'Uma nova tarefa foi atribuída a você: ' || NEW.titulo, 
            'task', 
            NEW.id
          );
       END IF;
    END IF;

  -- Handle UPDATE: If assignee changed
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL THEN
       IF EXISTS (SELECT 1 FROM profissionais WHERE id = NEW.assigned_to AND ativo = true) THEN
          INSERT INTO notifications (profissional_id, type, title, message, entity_type, entity_id)
          VALUES (
            NEW.assigned_to, 
            'task_assigned', 
            'Nova Atribuição', 
            'Tarefa atribuída a você: ' || NEW.titulo, 
            'task', 
            NEW.id
          );
       END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old trigger to recreate correctly
DROP TRIGGER IF EXISTS trigger_notify_task_assignment ON tarefas;

-- Create trigger for BOTH Insert and Update
CREATE TRIGGER trigger_notify_task_assignment
AFTER INSERT OR UPDATE ON tarefas
FOR EACH ROW
EXECUTE FUNCTION notify_task_assignment();
