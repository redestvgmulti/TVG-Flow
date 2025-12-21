-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PHASE 8.7: Notification Center
-- Apple-style persistent notifications with audit trail
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TABLE: notifications
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id UUID NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  cleared_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX idx_notifications_profissional ON notifications(profissional_id);
CREATE INDEX idx_notifications_read ON notifications(read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_cleared ON notifications(cleared_at) WHERE cleared_at IS NULL;
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RLS POLICIES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Professionals view own notifications
CREATE POLICY "Professionals view own notifications"
ON notifications FOR SELECT
TO authenticated
USING (profissional_id = auth.uid());

-- Professionals update own notifications (mark read/clear)
CREATE POLICY "Professionals update own notifications"
ON notifications FOR UPDATE
TO authenticated
USING (profissional_id = auth.uid())
WITH CHECK (profissional_id = auth.uid());

-- Admins view all notifications
CREATE POLICY "Admins view all notifications"
ON notifications FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profissionais
    WHERE profissionais.id = auth.uid()
    AND profissionais.role = 'admin'
    AND profissionais.ativo = true
  )
);

-- Admins can insert notifications (manual)
CREATE POLICY "Admins insert notifications"
ON notifications FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profissionais
    WHERE profissionais.id = auth.uid()
    AND profissionais.role = 'admin'
    AND profissionais.ativo = true
  )
);

-- System can insert notifications (via triggers)
CREATE POLICY "System insert notifications"
ON notifications FOR INSERT
TO authenticated
WITH CHECK (true);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TRIGGER: Task Assigned/Reassigned
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

DROP TRIGGER IF EXISTS trigger_notify_task_assignment ON tarefas;

CREATE TRIGGER trigger_notify_task_assignment
AFTER UPDATE ON tarefas
FOR EACH ROW
EXECUTE FUNCTION notify_task_assignment();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- TRIGGER: Task Completed
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

DROP TRIGGER IF EXISTS trigger_notify_task_completion ON tarefas;

CREATE TRIGGER trigger_notify_task_completion
AFTER UPDATE ON tarefas
FOR EACH ROW
EXECUTE FUNCTION notify_task_completion();

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- COMMENTS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON TABLE notifications IS 'Persistent notification center with audit trail';
COMMENT ON COLUMN notifications.profissional_id IS 'User who receives the notification';
COMMENT ON COLUMN notifications.type IS 'Notification type: task_assigned, task_completed, etc';
COMMENT ON COLUMN notifications.read_at IS 'When user marked as read (null = unread)';
COMMENT ON COLUMN notifications.cleared_at IS 'When user cleared notification (soft delete)';
COMMENT ON COLUMN notifications.entity_type IS 'Related entity type (task, etc)';
COMMENT ON COLUMN notifications.entity_id IS 'Related entity ID for navigation';
