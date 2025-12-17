-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Task Notifications System
-- Database triggers for task assignment, reassignment, and completion
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TABLE: notifications
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id UUID NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tarefas(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('task_assigned', 'task_reassigned', 'task_completed', 'deadline_approaching')),
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_notifications_profissional ON notifications(profissional_id);
CREATE INDEX idx_notifications_read ON notifications(read);
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_notifications_task ON notifications(task_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RLS POLICIES: notifications
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can view their own notifications
CREATE POLICY "Users can view own notifications"
ON notifications FOR SELECT
TO authenticated
USING (profissional_id = auth.uid());

-- Users can update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
ON notifications FOR UPDATE
TO authenticated
USING (profissional_id = auth.uid())
WITH CHECK (profissional_id = auth.uid());

-- System can insert notifications (via triggers)
CREATE POLICY "System can insert notifications"
ON notifications FOR INSERT
TO authenticated
WITH CHECK (true);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TRIGGER FUNCTION: Task Assigned
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION notify_task_assigned()
RETURNS TRIGGER AS $$
BEGIN
  -- Only if assigned_to is set and professional is active
  IF NEW.assigned_to IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM profissionais 
      WHERE id = NEW.assigned_to AND ativo = true
    ) THEN
      INSERT INTO notifications (profissional_id, task_id, type, message)
      VALUES (
        NEW.assigned_to,
        NEW.id,
        'task_assigned',
        'You have been assigned a new task: ' || NEW.titulo
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_notify_task_assigned
AFTER INSERT ON tarefas
FOR EACH ROW
EXECUTE FUNCTION notify_task_assigned();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TRIGGER FUNCTION: Task Reassigned
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION notify_task_reassigned()
RETURNS TRIGGER AS $$
BEGIN
  -- Only if assigned_to changed and new assignee is active
  IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to AND NEW.assigned_to IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM profissionais 
      WHERE id = NEW.assigned_to AND ativo = true
    ) THEN
      INSERT INTO notifications (profissional_id, task_id, type, message)
      VALUES (
        NEW.assigned_to,
        NEW.id,
        'task_reassigned',
        'You have been reassigned task: ' || NEW.titulo
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_notify_task_reassigned
AFTER UPDATE ON tarefas
FOR EACH ROW
EXECUTE FUNCTION notify_task_reassigned();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TRIGGER FUNCTION: Task Completed
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION notify_task_completed()
RETURNS TRIGGER AS $$
DECLARE
  admin_record RECORD;
BEGIN
  -- Only if status changed to completed
  IF OLD.status != 'completed' AND NEW.status = 'completed' THEN
    -- Notify all active admins
    FOR admin_record IN 
      SELECT id FROM profissionais 
      WHERE role = 'admin' AND ativo = true
    LOOP
      INSERT INTO notifications (profissional_id, task_id, type, message)
      VALUES (
        admin_record.id,
        NEW.id,
        'task_completed',
        'Task completed: ' || NEW.titulo
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_notify_task_completed
AFTER UPDATE ON tarefas
FOR EACH ROW
EXECUTE FUNCTION notify_task_completed();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- COMMENTS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON TABLE notifications IS 'Stores task-related notifications for professionals';
COMMENT ON COLUMN notifications.type IS 'Type of notification: task_assigned, task_reassigned, task_completed, deadline_approaching';
COMMENT ON COLUMN notifications.read IS 'Whether the notification has been read by the user';

COMMENT ON FUNCTION notify_task_assigned() IS 'Creates notification when task is assigned to active professional';
COMMENT ON FUNCTION notify_task_reassigned() IS 'Creates notification when task is reassigned to different active professional';
COMMENT ON FUNCTION notify_task_completed() IS 'Creates notifications for all active admins when task is completed';
