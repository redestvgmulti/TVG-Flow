-- Migration: Notify assigned professional when task details are updated

CREATE OR REPLACE FUNCTION notify_task_details_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if assigned professional exists and is active
  IF NEW.assigned_to IS NOT NULL AND EXISTS (SELECT 1 FROM profissionais WHERE id = NEW.assigned_to AND ativo = true) THEN
    
    -- Check if the update was made by someone else (avoid self-notification)
    -- notification should be sent if the current user is NOT the assignee.
    -- If auth.uid() is null (e.g. system update), we typically assume we should notify, 
    -- but usually system updates are rare or specific. safely assuming distinct from assignee covers null too if assignee is not null.
    IF auth.uid() IS DISTINCT FROM NEW.assigned_to THEN
      
      -- Detect meaningful changes (excluding assigned_to which is handled by another trigger)
      IF (NEW.titulo IS DISTINCT FROM OLD.titulo) OR
         (NEW.descricao IS DISTINCT FROM OLD.descricao) OR
         (NEW.deadline IS DISTINCT FROM OLD.deadline) OR
         (NEW.priority IS DISTINCT FROM OLD.priority) OR
         (NEW.status IS DISTINCT FROM OLD.status) OR
         (NEW.drive_link IS DISTINCT FROM OLD.drive_link) THEN
         
         INSERT INTO notifications (
           profissional_id,
           type,
           title,
           message,
           entity_type,
           entity_id
         )
         VALUES (
           NEW.assigned_to,
           'task_updated',
           'Tarefa Atualizada',
           'A tarefa "' || NEW.titulo || '" foi atualizada.',
           'task',
           NEW.id
         );
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_notify_task_details_change ON tarefas;

CREATE TRIGGER trigger_notify_task_details_change
AFTER UPDATE ON tarefas
FOR EACH ROW
EXECUTE FUNCTION notify_task_details_change();
