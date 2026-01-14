-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MANUAL OBSERVABILITY SETUP (FASE 5) - FINAL
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- INSTRUCTIONS:
-- 1. Copy this script.
-- 2. Go to Supabase Dashboard > SQL Editor.
-- 3. Run it to create monitoring views.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. ENABLE EXTENSION (Idempotent)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- 2. QUERY PERFORMANCE VIEW (vw_slow_queries)
-- Shows top 50 slowest queries.
-- NOTE: pg_stat_statements does NOT provide real p95/p99 percentiles without
-- significant overhead. We use mean_exec_time as the primary indicator.
CREATE OR REPLACE VIEW vw_slow_queries AS
SELECT 
    substring(query, 1, 150) as query_snippet,
    calls,
    round(total_exec_time::numeric / 1000, 4) as total_seconds,
    round(mean_exec_time::numeric, 2) as mean_ms,
    round(max_exec_time::numeric, 2) as max_ms,
    rows
FROM pg_stat_statements
WHERE query NOT ILIKE '%pg_stat_statements%' 
  AND query NOT ILIKE '%pg_catalog%'
  AND query NOT ILIKE '%information_schema%'
  -- Focus on application queries (SELECT, INSERT, UPDATE, DELETE)
  AND (
      query ILIKE 'SELECT%' OR 
      query ILIKE 'INSERT%' OR 
      query ILIKE 'UPDATE%' OR 
      query ILIKE 'DELETE%'
  )
  AND calls > 5
ORDER BY mean_exec_time DESC
LIMIT 50;

COMMENT ON VIEW vw_slow_queries IS 'Top 50 slowest application queries. NOTE: p95/p99 are not available in pg_stat_statements standard view.';

-- 3. ACTIVE LOCKS VIEW (vw_active_locks)
-- Shows current active locks and their duration
CREATE OR REPLACE VIEW vw_active_locks AS
SELECT 
    pid,
    usename as user,
    pg_blocking_pids(pid) as blocked_by,
    mode as lock_mode,
    locktype,
    granted,
    state,
    (now() - query_start) as lock_duration,
    substring(query, 1, 100) as query_snippet
FROM pg_stat_activity
JOIN pg_locks USING (pid)
WHERE pid != pg_backend_pid()
  AND (state = 'active' OR locktype = 'advisory')
  AND database = (SELECT oid FROM pg_database WHERE datname = current_database());

-- 4. BLOCKED QUERIES VIEW (vw_blocked_queries)
-- Detailed view of who is blocking whom
CREATE OR REPLACE VIEW vw_blocked_queries AS
SELECT 
    blocked_locks.pid     AS blocked_pid,
    blocked_activity.usename  AS blocked_user,
    blocked_activity.query    AS blocked_query,
    blocking_locks.pid     AS blocking_pid,
    blocking_activity.usename AS blocking_user,
    blocking_activity.query   AS blocking_query,
    (now() - blocked_activity.query_start) AS wait_duration
FROM pg_catalog.pg_locks         blocked_locks
JOIN pg_catalog.pg_stat_activity blocked_activity  ON blocked_activity.pid = blocked_locks.pid
JOIN pg_catalog.pg_locks         blocking_locks 
    ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
    AND blocking_locks.pid != blocked_locks.pid
JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
WHERE NOT blocked_locks.granted;

-- 5. TABLE SIZES VIEW (vw_table_sizes)
-- Shows real disk usage of tables
CREATE OR REPLACE VIEW vw_table_sizes AS
SELECT
    relname as table_name,
    pg_size_pretty(pg_total_relation_size(relid)) as total_size,
    pg_size_pretty(pg_relation_size(relid)) as data_size,
    pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) as index_size,
    n_live_tup as live_csv_rows_estimate
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;

COMMIT;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VERIFICATION COMMANDS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SELECT * FROM vw_slow_queries LIMIT 5;
-- SELECT * FROM vw_active_locks;
-- SELECT * FROM vw_blocked_queries;
-- SELECT * FROM vw_table_sizes;
