-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FlowOS Phase 3 Week 1 — Validation & Smoke Tests
-- Execute AFTER migrations 047-051 on branch database
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
\echo 'WEEK 1 VALIDATION — Async Notifications'
\echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
\echo ''

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. Verify Queue Table Exists
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\echo '1. Checking notification_queue table...'
SELECT 
    tablename,
    pg_size_pretty(pg_total_relation_size('notification_queue'::regclass)) as size
FROM pg_tables 
WHERE tablename = 'notification_queue';

-- Check indexes
\echo '   Checking indexes...'
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'notification_queue'
ORDER BY indexname;

\echo ''

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. Verify Sync Triggers Are DISABLED
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\echo '2. Verifying sync triggers are DISABLED...'
SELECT 
    c.relname AS table_name,
    t.tgname AS trigger_name,
    CASE t.tgenabled
        WHEN 'O' THEN '✅ Enabled'
        WHEN 'D' THEN '🔴 Disabled'
        ELSE t.tgenabled::text
    END AS status
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE t.tgname IN (
    'trg_notify_macro_completion',
    'trg_notify_micro_completion_admin',
    'trg_notify_micro_devolution_admin'
)
AND n.nspname = 'public'
AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

\echo ''

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. Verify Queue Triggers Are ENABLED
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\echo '3. Verifying queue triggers are ENABLED...'
SELECT 
    c.relname AS table_name,
    t.tgname AS trigger_name,
    CASE t.tgenabled
        WHEN 'O' THEN '✅ Enabled'
        WHEN 'D' THEN '🔴 Disabled'
        ELSE t.tgenabled::text
    END AS status
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE t.tgname IN (
    'trg_queue_macro_completion',
    'trg_queue_micro_completion',
    'trg_queue_micro_devolution'
)
AND n.nspname = 'public'
ORDER BY c.relname, t.tgname;

\echo ''

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. Verify pg_cron Jobs Are Scheduled
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\echo '4. Checking pg_cron jobs...'
SELECT 
    jobname,
    schedule,
    active,
    CASE WHEN active THEN '✅ Active' ELSE '🔴 Inactive' END as status
FROM cron.job
WHERE jobname IN ('process-notification-queue', 'cleanup-notification-queue')
ORDER BY jobname;

\echo ''

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. Check Monitoring Views Exist
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\echo '5. Verifying monitoring views...'
SELECT 
    viewname,
    definition IS NOT NULL as has_definition
FROM pg_views
WHERE viewname IN (
    'vw_notification_queue_health',
    'vw_notification_queue_alerts',
    'vw_cron_job_history'
)
ORDER BY viewname;

\echo ''

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 6. SMOKE TEST: Simulated Task Completion
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\echo '6. SMOKE TEST: Simulating task completion...'
\echo '   (This should INSERT into queue, NOT into notifications)'

-- Get a test task (if any exist)
DO $$
DECLARE
    v_test_task_id UUID;
    v_queue_count_before INT;
    v_queue_count_after INT;
    v_notif_count_before INT;
    v_notif_count_after INT;
BEGIN
    -- Count before
    SELECT COUNT(*) INTO v_queue_count_before FROM notification_queue;
    SELECT COUNT(*) INTO v_notif_count_before FROM notifications;

    -- Find a test macro task
    SELECT id INTO v_test_task_id 
    FROM tarefas 
    WHERE status != 'concluida' 
    LIMIT 1;

    IF v_test_task_id IS NOT NULL THEN
        -- Simulate completion
        UPDATE tarefas 
        SET status = 'concluida' 
        WHERE id = v_test_task_id;

        -- Count after
        SELECT COUNT(*) INTO v_queue_count_after FROM notification_queue;
        SELECT COUNT(*) INTO v_notif_count_after FROM notifications;

        RAISE NOTICE '   ✅ Queue count: % → % (expected +1)', v_queue_count_before, v_queue_count_after;
        RAISE NOTICE '   ✅ Notifications count: % → % (expected +0, async processing)', v_notif_count_before, v_notif_count_after;

        IF v_queue_count_after = v_queue_count_before + 1 THEN
            RAISE NOTICE '   ✅ PASS: Event queued successfully';
        ELSE
            RAISE WARNING '   ❌ FAIL: Queue count did not increase';
        END IF;

        -- Rollback test change
        ROLLBACK;
    ELSE
        RAISE NOTICE '   ⚠️  No test tasks available for smoke test';
    END IF;
END $$;

\echo ''

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 7. Queue Health Check
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\echo '7. Current queue health...'
SELECT * FROM vw_notification_queue_health;

\echo ''

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 8. Alert Check
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\echo '8. Alert status...'
SELECT * FROM vw_notification_queue_alerts;

\echo ''

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SUMMARY
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

\echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
\echo 'VALIDATION COMPLETE'
\echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
\echo ''
\echo 'Expected Results:'
\echo '  ✅ notification_queue table exists with 4 indexes'
\echo '  ✅ 3 sync triggers DISABLED'
\echo '  ✅ 3 queue triggers ENABLED'
\echo '  ✅ 2 pg_cron jobs ACTIVE'
\echo '  ✅ 3 monitoring views created'
\echo '  ✅ Smoke test: Queue +1, Notifications +0'
\echo ''
\echo 'Next Steps:'
\echo '  1. Monitor queue processing (wait 30-60s)'
\echo '  2. Check vw_cron_job_history for execution'
\echo '  3. Verify notifications appear after processing'
\echo '  4. If OK → Deploy to production (staged)'
\echo ''
