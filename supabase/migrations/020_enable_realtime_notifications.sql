-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Enable Realtime for Notifications Table
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Enable Realtime publication for notifications table
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Set REPLICA IDENTITY to FULL to ensure all columns are sent in realtime events
ALTER TABLE notifications REPLICA IDENTITY FULL;

-- Add comment
COMMENT ON TABLE notifications IS 'Notifications table with Realtime enabled for instant updates';
