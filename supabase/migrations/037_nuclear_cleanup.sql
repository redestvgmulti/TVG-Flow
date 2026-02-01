-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: CLEANUP TRIGGERS & FIX NOTIFICATIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Drop ALL potential conflicting triggers on 'tarefas'
-- We use DO block to avoid errors if they don't exist
DROP TRIGGER IF EXISTS trigger_notify_task_assigned ON tarefas;
DROP TRIGGER IF EXISTS trigger_notify_task_reassigned ON tarefas;
DROP TRIGGER IF EXISTS trigger_notify_task_completed ON tarefas;
DROP TRIGGER IF EXISTS trigger_notify_task_assignment ON tarefas;
DROP TRIGGER IF EXISTS trigger_notify_task_details_change ON tarefas; -- From 015
DROP TRIGGER IF EXISTS trigger_task_notifications ON tarefas; -- Hypothetical name

-- 2. Clean up 'notifications' table triggers
DROP TRIGGER IF EXISTS trigger_push_notification_on_insert ON notifications;

-- 3. Re-create the SINGLE authoritative Task Assignment Trigger (Logic from 018)
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

-- 4. Create the Trigger
CREATE TRIGGER trigger_notify_task_assignment
AFTER INSERT OR UPDATE ON tarefas
FOR EACH ROW
EXECUTE FUNCTION notify_task_assignment();


-- 5. Re-create the Push Notification Trigger on 'notifications'
-- (Logic from 017)
CREATE OR REPLACE FUNCTION trigger_send_push_notification()
RETURNS TRIGGER AS $$
DECLARE
  url TEXT := 'https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/send-push-notification';
  -- Use service role key if possible, but for net.http_post we might need anon or service.
  -- Ideally we pass the SERVICE KEY in the function itself or use a stored secret.
  -- For now, using the hardcoded key from 017 but ensuring headers are correct.
  api_key TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5b294bXB5eG5jcmV6amlsanJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4MDE2MzUsImV4cCI6MjA4MTM3NzYzNX0.mn0Y66MZ6DHxdyMg2Oh6bSIi2CC5h8RmN5N4hlyqhog';
  payload JSONB;
  request_id BIGINT;
BEGIN
  -- Payload matches what Edge Function expects (notificationId)
  payload := jsonb_build_object('notificationId', NEW.id);
  
  -- Call Edge Function asynchronously
  SELECT net.http_post(
    url := url,
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || api_key
    )
  ) INTO request_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_push_notification_on_insert
AFTER INSERT ON notifications
FOR EACH ROW
EXECUTE FUNCTION trigger_send_push_notification();
