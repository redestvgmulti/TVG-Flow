-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Enable Realtime for notifications table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Enable realtime publication for notifications table
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Ensure RLS is enabled (should already be, but confirming)
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Verify that users can SELECT their own notifications (required for realtime)
-- This policy should already exist, but we'll recreate it to be sure
DROP POLICY IF EXISTS "Professionals view own notifications" ON notifications;

CREATE POLICY "Professionals view own notifications"
ON notifications FOR SELECT
TO authenticated
USING (profissional_id = auth.uid());
