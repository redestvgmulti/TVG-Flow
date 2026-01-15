-- ============================================================================
-- FLOWOS - MANUAL OBSERVABILITY VIEWS
-- ============================================================================
-- Purpose: Passive monitoring for query performance, locks, and data growth
-- Overhead: Minimal (view-only, no triggers/cron)
-- Dependencies: pg_stat_statements (Supabase default)
-- ============================================================================

-- ============================================================================
-- 1. QUERY PERFORMANCE MONITORING
-- ============================================================================

-- View: vw_slow_queries
-- Purpose: Track slow queries based on mean execution time
-- IMPORTANT LIMITATION: pg_stat_statements does NOT provide real percentiles
-- (p95/p99). We only expose accurate metrics: mean, max, calls, total.
-- ============================================================================
CREATE OR REPLACE VIEW vw_slow_queries AS
SELECT 
    SUBSTRING(query, 1, 200) AS query_snippet,
    query,
    calls,
    ROUND(mean_exec_time::numeric, 2) AS mean_exec_time_ms,
    ROUND(max_exec_time::numeric, 2) AS max_exec_time_ms,
    ROUND(total_exec_time::numeric, 2) AS total_exec_time_ms,
    ROUND((total_exec_time / NULLIF(calls, 0))::numeric, 2) AS avg_time_per_call_ms
FROM 
    pg_stat_statements
WHERE 
    -- Filter out system and observability queries
    query NOT LIKE '%pg_catalog%'
    AND query NOT LIKE '%information_schema%'
    AND query NOT LIKE '%pg_stat_statements%'
    AND query NOT LIKE '%vw_slow_queries%'
    AND query NOT LIKE '%vw_active_locks%'
    AND query NOT LIKE '%vw_blocked_queries%'
    AND query NOT LIKE '%vw_table_sizes%'
    -- Focus on app queries only
    AND dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY 
    mean_exec_time DESC;

COMMENT ON VIEW vw_slow_queries IS 
'Query performance monitoring. LIMITATION: pg_stat_statements does not provide true percentiles (p95/p99). Use mean_exec_time and max_exec_time for analysis.';

-- ============================================================================
-- 2. LOCK MONITORING
-- ============================================================================

-- View: vw_active_locks
-- Purpose: Show all active locks with duration
-- ============================================================================
CREATE OR REPLACE VIEW vw_active_locks AS
SELECT 
    l.pid,
    l.locktype,
    l.mode,
    COALESCE(c.relname, 'N/A') AS relation,
    a.query,
    a.state,
    EXTRACT(EPOCH FROM (now() - a.query_start))::integer AS lock_duration_seconds,
    a.query_start,
    a.wait_event_type,
    a.wait_event
FROM 
    pg_locks l
    LEFT JOIN pg_class c ON l.relation = c.oid
    LEFT JOIN pg_stat_activity a ON l.pid = a.pid
WHERE 
    -- Only active locks
    (a.state = 'active' OR a.wait_event_type = 'Lock')
    -- Exclude our own monitoring queries
    AND a.query NOT LIKE '%vw_active_locks%'
    AND a.query NOT LIKE '%vw_blocked_queries%'
ORDER BY 
    lock_duration_seconds DESC;

COMMENT ON VIEW vw_active_locks IS 
'Active locks with duration. Shows only locks from active queries or queries waiting on locks.';

-- ============================================================================
-- View: vw_blocked_queries
-- Purpose: Identify blocking relationships (who is blocking whom)
-- ============================================================================
CREATE OR REPLACE VIEW vw_blocked_queries AS
SELECT 
    blocked.pid AS blocked_pid,
    blocked.query AS blocked_query,
    blocked.state AS blocked_state,
    EXTRACT(EPOCH FROM (now() - blocked.query_start))::integer AS blocked_duration_seconds,
    blocking.pid AS blocking_pid,
    blocking.query AS blocking_query,
    blocking.state AS blocking_state,
    EXTRACT(EPOCH FROM (now() - blocking.query_start))::integer AS blocking_duration_seconds
FROM 
    pg_stat_activity AS blocked
    JOIN pg_locks AS blocked_locks ON blocked.pid = blocked_locks.pid
    JOIN pg_locks AS blocking_locks ON blocked_locks.locktype = blocking_locks.locktype
        AND blocked_locks.database IS NOT DISTINCT FROM blocking_locks.database
        AND blocked_locks.relation IS NOT DISTINCT FROM blocking_locks.relation
        AND blocked_locks.page IS NOT DISTINCT FROM blocking_locks.page
        AND blocked_locks.tuple IS NOT DISTINCT FROM blocking_locks.tuple
        AND blocked_locks.virtualxid IS NOT DISTINCT FROM blocking_locks.virtualxid
        AND blocked_locks.transactionid IS NOT DISTINCT FROM blocking_locks.transactionid
        AND blocked_locks.classid IS NOT DISTINCT FROM blocking_locks.classid
        AND blocked_locks.objid IS NOT DISTINCT FROM blocking_locks.objid
        AND blocked_locks.objsubid IS NOT DISTINCT FROM blocking_locks.objsubid
        AND blocked_locks.pid != blocking_locks.pid
    JOIN pg_stat_activity AS blocking ON blocking_locks.pid = blocking.pid
WHERE 
    NOT blocked_locks.granted
    AND blocking_locks.granted
    -- Exclude monitoring queries
    AND blocked.query NOT LIKE '%vw_blocked_queries%'
    AND blocking.query NOT LIKE '%vw_blocked_queries%'
ORDER BY 
    blocked_duration_seconds DESC;

COMMENT ON VIEW vw_blocked_queries IS 
'Shows blocking relationships: which queries are blocked and by whom, with durations.';

-- ============================================================================
-- 3. GROWTH MONITORING
-- ============================================================================

-- View: vw_table_sizes
-- Purpose: Track table and index sizes for growth analysis
-- ============================================================================
CREATE OR REPLACE VIEW vw_table_sizes AS
SELECT 
    n.nspname AS schema_name,
    c.relname AS table_name,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size_pretty,
    pg_total_relation_size(c.oid) AS total_size_bytes,
    pg_size_pretty(pg_relation_size(c.oid)) AS table_size_pretty,
    pg_relation_size(c.oid) AS table_size_bytes,
    pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS index_size_pretty,
    (pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS index_size_bytes,
    c.reltuples::bigint AS estimated_row_count
FROM 
    pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE 
    c.relkind = 'r'  -- Regular tables only
    AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
ORDER BY 
    pg_total_relation_size(c.oid) DESC;

COMMENT ON VIEW vw_table_sizes IS 
'Table and index sizes for growth monitoring. Includes estimated row counts.';

-- ============================================================================
-- USAGE INSTRUCTIONS
-- ============================================================================
-- Weekly:  SELECT * FROM vw_slow_queries WHERE mean_exec_time_ms > 200;
-- Monthly: Compare vw_table_sizes total_size_bytes over time for >20% growth
-- Incident: SELECT * FROM vw_blocked_queries; to diagnose lock issues
-- ============================================================================
