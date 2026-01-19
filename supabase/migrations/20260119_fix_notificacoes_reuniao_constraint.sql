-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FIX: MEETING NOTIFICATIONS CONSTRAINT
-- Date: 2026-01-19
-- Status: PRODUCTION-CRITICAL | BACKWARD-COMPATIBLE | ZERO DATA IMPACT
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- ROOT CAUSE:
--   Constraint `tem_referencia` requires os_id OR evento_id to be NOT NULL.
--   Meeting notifications use metadata->>'reuniao_id' instead.
--   Result: 100% of meeting notifications blocked at INSERT.
-- 
-- SOLUTION:
--   Relax constraint to accept os_id OR evento_id OR metadata->>'reuniao_id'.
--   No code changes needed. No data migration needed.
-- 
-- SAFETY:
--   ✅ Existing OS notifications: continue requiring os_id
--   ✅ Existing event notifications: continue requiring evento_id  
--   ✅ New meeting notifications: allowed via metadata->>'reuniao_id'
--   ✅ No existing rows affected (all already satisfy new constraint)
--   ✅ Fully reversible
-- 
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 1: Remove blocking constraint
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE notificacoes
DROP CONSTRAINT IF EXISTS tem_referencia;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 2: Recreate constraint allowing meeting notifications
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE notificacoes
ADD CONSTRAINT tem_referencia
CHECK (
    os_id IS NOT NULL                          -- ✅ OS/Task notifications
    OR evento_id IS NOT NULL                   -- ✅ Event notifications
    OR (metadata->>'reuniao_id') IS NOT NULL   -- ✅ Meeting notifications
);

COMMENT ON CONSTRAINT tem_referencia ON notificacoes IS
'Ensures notification is linked to an OS (os_id), event (evento_id), or meeting (metadata.reuniao_id). Supports multi-type notification system.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VALIDATION: Verify no existing rows violated
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
DECLARE
    v_violating_count INT;
BEGIN
    -- Check if any existing row would violate the new constraint
    SELECT COUNT(*)
    INTO v_violating_count
    FROM notificacoes
    WHERE os_id IS NULL 
      AND evento_id IS NULL 
      AND (metadata->>'reuniao_id') IS NULL;
    
    IF v_violating_count > 0 THEN
        RAISE EXCEPTION 'Migration aborted: % existing row(s) would violate new constraint', v_violating_count;
    END IF;
    
    RAISE NOTICE '✅ Validation passed: All existing rows satisfy new constraint';
    RAISE NOTICE '✅ Meeting notifications now enabled via metadata.reuniao_id';
END $$;

COMMIT;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION COMPLETE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- NEXT STEPS (AUTOMATED BY RPC):
--   1. create_meeting_notification RPC will now succeed
--   2. Edge Function meeting-reminders will create notifications
--   3. Idempotency index will prevent duplicates
--   4. Frontend meeting creation will trigger invite notifications
-- 
-- ROLLBACK (if needed):
--   ALTER TABLE notificacoes DROP CONSTRAINT tem_referencia;
--   ALTER TABLE notificacoes ADD CONSTRAINT tem_referencia 
--     CHECK (os_id IS NOT NULL OR evento_id IS NOT NULL);
-- 
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
