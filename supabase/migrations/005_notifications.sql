-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PHASE 8.7 — Notification Center (FIXED)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ⚠️ IMPORTANTE:
-- Índices básicos já existem em migrations anteriores
-- Aqui só evoluímos o schema e RLS


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SAFE COLUMN EVOLUTION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- INDEXES (ONLY IF NOT PRESENT)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_notifications_read'
  ) THEN
    CREATE INDEX idx_notifications_read
      ON notifications(read_at)
      WHERE read_at IS NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_notifications_cleared'
  ) THEN
    CREATE INDEX idx_notifications_cleared
      ON notifications(cleared_at)
      WHERE cleared_at IS NULL;
  END IF;
END$$;


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- RLS (DROP + CREATE — SEM IF NOT EXISTS)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Professionals view own notifications" ON notifications;
CREATE POLICY "Professionals view own notifications"
ON notifications
FOR SELECT
TO authenticated
USING (profissional_id = auth.uid());

DROP POLICY IF EXISTS "Professionals update own notifications" ON notifications;
CREATE POLICY "Professionals update own notifications"
ON notifications
FOR UPDATE
TO authenticated
USING (profissional_id = auth.uid())
WITH CHECK (profissional_id = auth.uid());

DROP POLICY IF EXISTS "Admins view all notifications" ON notifications;
CREATE POLICY "Admins view all notifications"
ON notifications
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM profissionais
    WHERE profissionais.id = auth.uid()
      AND profissionais.role = 'admin'
      AND profissionais.ativo = true
  )
);

DROP POLICY IF EXISTS "Admins insert notifications" ON notifications;
CREATE POLICY "Admins insert notifications"
ON notifications
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM profissionais
    WHERE profissionais.id = auth.uid()
      AND profissionais.role = 'admin'
      AND profissionais.ativo = true
  )
);

DROP POLICY IF EXISTS "System insert notifications" ON notifications;
CREATE POLICY "System insert notifications"
ON notifications
FOR INSERT
TO authenticated
WITH CHECK (true);


-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- COMMENTS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON TABLE notifications IS
  'Persistent notification center with audit trail';