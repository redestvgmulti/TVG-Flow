-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FINAL FIX: Complete Trigger Reset
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Drop ALL triggers on tarefas table (comprehensive)
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tgname FROM pg_trigger WHERE tgrelid = 'tarefas'::regclass)
    LOOP
        EXECUTE 'DROP TRIGGER IF EXISTS ' || r.tgname || ' ON tarefas CASCADE';
    END LOOP;
END $$;

-- 2. Drop ALL triggers on notifications table
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tgname FROM pg_trigger WHERE tgrelid = 'notifications'::regclass)
    LOOP
        EXECUTE 'DROP TRIGGER IF EXISTS ' || r.tgname || ' ON notifications CASCADE';
    END LOOP;
END $$;

-- 3. Create SINGLE task notification trigger
CREATE OR REPLACE FUNCTION notify_task_assignment()
RETURNS TRIGGER AS $$
BEGIN
  -- Only on INSERT with assigned_to
  IF (TG_OP = 'INSERT' AND NEW.assigned_to IS NOT NULL) THEN
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
  -- Only on UPDATE when assignee changes
  ELSIF (TG_OP = 'UPDATE' AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL) THEN
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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_notify_task_assignment
AFTER INSERT OR UPDATE ON tarefas
FOR EACH ROW
EXECUTE FUNCTION notify_task_assignment();

-- 4. Temporarily DISABLE push notification trigger
-- (We'll fix the edge function first, then re-enable)
-- CREATE TRIGGER trigger_push_notification_on_insert
-- AFTER INSERT ON notifications
-- FOR EACH ROW
-- EXECUTE FUNCTION trigger_send_push_notification();
