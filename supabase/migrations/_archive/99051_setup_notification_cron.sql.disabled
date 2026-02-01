-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FlowOS Phase 3 — Async Notifications: Setup pg_cron
-- Migration 051: Schedule queue processor and monitoring
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. Schedule Notification Queue Processor
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Remove any existing job with same name
SELECT cron.unschedule('process-notification-queue');

-- Schedule processor every 30 seconds
-- Format: '*/30 * * * * *' = every 30 seconds
-- Cron format: second minute hour day month weekday
SELECT cron.schedule(
    'process-notification-queue',           -- job name
    '*/30 * * * * *',                       -- every 30 seconds
    $$SELECT process_notification_queue();$$  -- SQL to execute
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. Optional: Daily Cleanup Job (Belt & Suspenders)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Although cleanup is embedded in the processor function (MUST-3),
-- we add a dedicated daily job for extra safety (run at 3 AM)

SELECT cron.unschedule('cleanup-notification-queue');

SELECT cron.schedule(
    'cleanup-notification-queue',
    '0 3 * * *',  -- Daily at 3:00 AM
    $$
    DELETE FROM notification_queue
    WHERE status IN ('completed', 'failed')
      AND processed_at < NOW() - INTERVAL '7 days';
    $$
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. Validation: Check Scheduled Jobs
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 
    jobid,
    jobname,
    schedule,
    command,
    active,
    CASE 
        WHEN active THEN '✅ Active'
        ELSE '🔴 Inactive'
    END as status
FROM cron.job
WHERE jobname IN ('process-notification-queue', 'cleanup-notification-queue')
ORDER BY jobname;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. Monitor Job Execution History (Last 24 hours)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE VIEW vw_cron_job_history AS
SELECT 
    job.jobname,
    run.status,
    run.return_message,
    run.start_time,
    run.end_time,
    EXTRACT(EPOCH FROM (run.end_time - run.start_time)) * 1000 as duration_ms
FROM cron.job_run_details run
JOIN cron.job ON run.jobid = job.jobid
WHERE run.start_time > NOW() - INTERVAL '24 hours'
  AND job.jobname IN ('process-notification-queue', 'cleanup-notification-queue')
ORDER BY run.start_time DESC
LIMIT 100;

COMMENT ON VIEW vw_cron_job_history IS 'Monitor pg_cron job execution history (last 24h)';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. SHOULD-2: Alert View for Critical Backlog
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE VIEW vw_notification_queue_alerts AS
SELECT 
    CASE 
        WHEN pending_count > 1000 THEN '🔴 CRITICAL'
        WHEN pending_count > 500 THEN '🟠 WARNING'
        WHEN oldest_age_seconds > 300 THEN '🟡 DELAYED'
        ELSE '✅ OK'
    END as alert_level,
    pending_count,
    oldest_age_seconds,
    CASE 
        WHEN pending_count > 1000 THEN 'Queue depth exceeds 1000 items'
        WHEN oldest_age_seconds > 300 THEN 'Oldest pending item > 5 minutes old'
        ELSE 'System healthy'
    END as message,
    NOW() as checked_at
FROM (
    SELECT 
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'pending')))::INT, 0) as oldest_age_seconds
    FROM notification_queue
    WHERE created_at > NOW() - INTERVAL '1 hour'
) stats;

COMMENT ON VIEW vw_notification_queue_alerts IS 'Real-time alerting for notification queue health (SHOULD-2)';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 6. Success Report
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
DECLARE
    v_job_count INT;
BEGIN
    SELECT COUNT(*) INTO v_job_count
    FROM cron.job
    WHERE jobname IN ('process-notification-queue', 'cleanup-notification-queue')
      AND active = true;
    
    IF v_job_count != 2 THEN
        RAISE WARNING 'Expected 2 active cron jobs, found %', v_job_count;
    ELSE
        RAISE NOTICE '✅ pg_cron setup complete: 2 jobs scheduled and active';
        RAISE NOTICE '   - process-notification-queue: every 30s';
        RAISE NOTICE '   - cleanup-notification-queue: daily at 3 AM';
    END IF;
END $$;

-- Final summary
SELECT 
    'pg_cron Setup' as migration,
    '✅ COMPLETE' as status,
    'Queue processor (30s) + Daily cleanup (3 AM) + Monitoring views' as summary;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- WEEK 1 COMPLETE CHECKLIST
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/*
✅ Migration 047: notification_queue table + indexes
✅ Migration 048: Disabled sync triggers
✅ Migration 049: process_notification_queue() function
✅ Migration 050: Replaced sync triggers with queue inserts
✅ Migration 051: pg_cron scheduler + monitoring

NEXT STEPS:
1. Execute all 5 migrations on BRANCH database
2. Run smoke tests (manual task completion)
3. Monitor vw_notification_queue_health
4. If OK → Deploy to production (staged)
5. Monitor for 48 hours
*/
