-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FlowOS Phase 3 — Async Notifications: Disable Sync Triggers
-- Migration 048: CRITICAL - Disable sync triggers BEFORE activating queue
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ⚠️ MUST EXECUTE BEFORE MIGRATION 050 (queue activation)
-- Prevents DUPLICATION (sync + async running simultaneously)

-- 1. Disable-- Macro task completion notification trigger
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notify_macro_completion') THEN
    ALTER TABLE tarefas DISABLE TRIGGER trg_notify_macro_completion;
  END IF;
END$$;

-- Micro task completion notification trigger  
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notify_micro_completion_admin') THEN
    ALTER TABLE tarefas_micro DISABLE TRIGGER trg_notify_micro_completion_admin;
  END IF;
END$$;

-- Micro task devolution notification trigger
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notify_micro_devolution_admin') THEN
    ALTER TABLE tarefas_micro DISABLE TRIGGER trg_notify_micro_devolution_admin;
  END IF;
END$$;

-- 4. Keep task assignment trigger active for now (not critical for lock contention)
-- We'll migrate this in Phase 2 if needed
-- ALTER TABLE tarefas DISABLE TRIGGER IF EXISTS trigger_notify_task_assignment;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VALIDATION: Check disabled triggers
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
DECLARE
    v_disabled_count INT;
BEGIN
    SELECT COUNT(*) INTO v_disabled_count
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON t.tgrelid = c.oid
    JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
    WHERE tgname IN (
        'trg_notify_macro_completion',
        'trg_notify_micro_completion_admin',
        'trg_notify_micro_devolution_admin'
    )
    AND nspname = 'public'
    AND tgenabled = 'D';  -- 'D' = disabled
    
    IF v_disabled_count != 3 THEN
        RAISE WARNING 'Expected 3 disabled triggers, found %', v_disabled_count;
    ELSE
        RAISE NOTICE '✅ All 3 sync notification triggers successfully disabled';
    END IF;
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- DOCUMENTATION: List all notification-related triggers and their status
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SELECT 
    n.nspname AS schema,
    c.relname AS table_name,
    t.tgname AS trigger_name,
    CASE t.tgenabled
        WHEN 'O' THEN '✅ Enabled'
        WHEN 'D' THEN '🔴 Disabled'
        WHEN 'R' THEN '🟡 Replica'
        WHEN 'A' THEN '🟠 Always'
        ELSE t.tgenabled::text
    END AS status,
    pg_get_triggerdef(t.oid) AS definition
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON t.tgrelid = c.oid
JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
WHERE tgname LIKE '%notify%'
  AND nspname = 'public'
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;
