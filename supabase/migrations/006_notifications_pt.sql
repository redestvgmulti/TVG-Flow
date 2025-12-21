-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Update Notification Messages to Portuguese
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Update Task Assignment Notification Function
CREATE OR REPLACE FUNCTION notify_task_assignment()
RETURNS TRIGGER AS $$
BEGIN
  -- Only if assigned_to changed and new assignee exists and is active
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM profissionais 
      WHERE id = NEW.assigned_to AND ativo = true
    ) THEN
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
        'task_assigned',
        'Nova tarefa atribuída',
        'Você foi designado para: ' || NEW.titulo,
        'task',
        NEW.id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update Task Completion Notification Function
CREATE OR REPLACE FUNCTION notify_task_completion()
RETURNS TRIGGER AS $$
BEGIN
  -- Only if status changed to completed
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    -- Notify all active admins
    INSERT INTO notifications (
      profissional_id,
      type,
      title,
      message,
      entity_type,
      entity_id
    )
    SELECT
      id,
      'task_completed',
      'Tarefa concluída',
      NEW.titulo || ' foi concluída',
      'task',
      NEW.id
    FROM profissionais
    WHERE role = 'admin' AND ativo = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
