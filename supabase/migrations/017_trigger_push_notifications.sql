-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Trigger: Send Push Notification via Edge Function
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS "pg_net";

-- Function to call Edge Function
CREATE OR REPLACE FUNCTION trigger_send_push_notification()
RETURNS TRIGGER AS $$
DECLARE
  url TEXT := 'https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/send-push-notification';
  api_key TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5b294bXB5eG5jcmV6amlsanJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU4MDE2MzUsImV4cCI6MjA4MTM3NzYzNX0.mn0Y66MZ6DHxdyMg2Oh6bSIi2CC5h8RmN5N4hlyqhog';
  payload JSONB;
  request_id BIGINT;
BEGIN
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

-- Create Trigger
DROP TRIGGER IF EXISTS trigger_push_notification_on_insert ON notifications;

CREATE TRIGGER trigger_push_notification_on_insert
AFTER INSERT ON notifications
FOR EACH ROW
EXECUTE FUNCTION trigger_send_push_notification();
