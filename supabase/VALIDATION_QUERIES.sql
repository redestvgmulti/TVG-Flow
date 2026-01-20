-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VALIDATION QUERIES: Security Fix for Hardcoded Secrets
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Run these queries AFTER applying migration 20260120_security_remove_hardcoded_anon_key.sql
-- All queries should return 0 results or confirm the fix was successful.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- QUERY 1: Detect any function/procedure containing JWT-like strings
-- EXPECTED RESULT: 0 rows (no active routines should contain JWT patterns)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT 
    n.nspname AS schema_name,
    p.proname AS function_name,
    pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE 
    n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND pg_get_functiondef(p.oid) ~ 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
ORDER BY n.nspname, p.proname;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- QUERY 2: Detect functions containing literal string 'api_key TEXT :='
-- EXPECTED RESULT: 0 rows
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT 
    n.nspname AS schema_name,
    p.proname AS function_name,
    pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE 
    n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND pg_get_functiondef(p.oid) ~ 'api_key TEXT :='
ORDER BY n.nspname, p.proname;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- QUERY 3: Inspect current definition of trigger_send_push_notification()
-- EXPECTED RESULT: Function definition WITHOUT any hardcoded JWT or api_key variable
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT pg_get_functiondef('trigger_send_push_notification'::regproc);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- QUERY 4: Verify trigger is still active and attached to notifications table
-- EXPECTED RESULT: 1 row showing trigger exists and is ENABLED
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT 
    tgname AS trigger_name,
    tgrelid::regclass AS table_name,
    tgenabled AS is_enabled,
    pg_get_triggerdef(oid) AS trigger_definition
FROM pg_trigger
WHERE tgname = 'trigger_push_notification_on_insert';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- QUERY 5: Functional test - Insert a test notification (will trigger the function)
-- EXPECTED RESULT: Insert succeeds WITHOUT errors
-- NOTE: Replace with real profissional_id from your database
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/*
BEGIN;
INSERT INTO notifications (profissional_id, type, title, message, entity_type)
VALUES (
    (SELECT id FROM profissionais LIMIT 1),
    'test',
    'Security Test',
    'Testing trigger after security fix',
    'system'
);
ROLLBACK; -- Rollback to avoid polluting production data
*/

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- QUERY 6: Search for any remaining suspicious patterns
-- EXPECTED RESULT: 0 rows
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SELECT 
    n.nspname AS schema_name,
    p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE 
    n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND (
        pg_get_functiondef(p.oid) ~* 'service.?role.?key'
        OR pg_get_functiondef(p.oid) ~* 'anon.?key'
        OR pg_get_functiondef(p.oid) ~ 'eyJ[A-Za-z0-9_-]{10,}\.'
    )
ORDER BY n.nspname, p.proname;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CONFIRMATION CHECKLIST
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- After running all queries above, confirm:
-- [ ] Query 1 returns 0 rows
-- [ ] Query 2 returns 0 rows
-- [ ] Query 3 shows function definition WITHOUT 'api_key TEXT :=' or JWT string
-- [ ] Query 4 shows trigger is ENABLED (tgenabled = 'O')
-- [ ] Query 5 (functional test) completes without SQL errors
-- [ ] Query 6 returns 0 rows
-- [ ] No errors in Supabase logs after applying migration
-- [ ] Push notifications still work in production (verify with real notification)
