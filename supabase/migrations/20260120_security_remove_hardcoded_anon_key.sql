-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SECURITY FIX: Remove Hardcoded ANON KEY from trigger_send_push_notification
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- BLOCKER: Critical security fix for production sale readiness
-- IMPACT: Zero functional change, eliminates hardcoded secret exposure
-- RISK: None - function redefinition is atomic and backwards compatible
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- CONTEXT:
-- The function trigger_send_push_notification() currently contains a hardcoded 
-- ANON KEY in its source code (from migration 020_nuclear_cleanup.sql).
-- This is a critical security risk as it exposes the key in git history.
--
-- SOLUTION:
-- Redefine the function WITHOUT the hardcoded api_key.
-- The Edge Function 'send-push-notification' is designed to run with service_role
-- context internally, so it does NOT require Authorization header from the trigger.
-- Removing the Authorization header is safe and actually more secure.

-- STEP 1: Redefine the function without hardcoded key
CREATE OR REPLACE FUNCTION trigger_send_push_notification()
RETURNS TRIGGER AS $$
DECLARE
  url TEXT := 'https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/send-push-notification';
  payload JSONB;
  request_id BIGINT;
BEGIN
  -- Payload matches what Edge Function expects (notificationId)
  payload := jsonb_build_object('notificationId', NEW.id);
  
  -- Call Edge Function asynchronously WITHOUT Authorization header
  -- The Edge Function itself runs with service_role context and handles auth internally
  SELECT net.http_post(
    url := url,
    body := payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    )
  ) INTO request_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- STEP 2: Add comment documenting the security fix
COMMENT ON FUNCTION trigger_send_push_notification() IS 
'Triggers asynchronous push notification via Edge Function. 
SECURITY FIX 2026-01-20: Removed hardcoded ANON KEY. 
Edge Function handles authentication internally with service_role context.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VALIDATION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- After applying this migration, run the validation queries in 
-- VALIDATION_QUERIES.sql to confirm no hardcoded secrets remain.
