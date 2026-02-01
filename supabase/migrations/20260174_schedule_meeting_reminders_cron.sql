-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CRON JOB: MEETING REMINDERS
-- Date: 2026-01-18
-- Status: PRODUCTION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PURPOSE: Schedule meeting-reminders Edge Function to run every 5 minutes
-- FUNCTION: https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/meeting-reminders
-- 
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Schedule cron job to call meeting-reminders Edge Function
SELECT cron.schedule(
    'meeting-reminders-cron',                        -- Job name
    '*/5 * * * *',                                   -- Every 5 minutes
    $$
    SELECT net.http_post(
        url := 'https://gyooxmpyxncrezjiljrj.supabase.co/functions/v1/meeting-reminders',
        headers := jsonb_build_object(
            'Authorization', 
            'Bearer ' || current_setting('app.settings.anon_key')
        )
    ) AS request_id;
    $$
);

-- Verify cron job was created
SELECT jobname, schedule, command 
FROM cron.job 
WHERE jobname = 'meeting-reminders-cron';
