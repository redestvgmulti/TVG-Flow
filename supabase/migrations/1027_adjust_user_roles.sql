-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1027: Adjust User Roles
-- Date: 2026-01-12
-- Description: Reverts Evandro to 'profissional' and ensures Administracao is 'admin'.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. Revert Evandro to 'profissional' (Staff)
UPDATE profissionais
SET role = 'profissional'
WHERE email = 'evandro@tvgflow.com';

-- 2. Set Administracao to 'admin'
UPDATE profissionais
SET role = 'admin'
WHERE email = 'adminstracao@tvgflow.com';

-- 3. Log results
DO $$
DECLARE
    evandro_count integer;
    admin_count integer;
BEGIN
    -- Check Evandro update (we can't get ROW_COUNT for specific previous statements easily in a block like this without multiple GET DIAGNOSTICS, so we'll just check state)
    SELECT COUNT(*) INTO evandro_count FROM profissionais WHERE email = 'evandro@tvgflow.com' AND role = 'profissional';
    SELECT COUNT(*) INTO admin_count FROM profissionais WHERE email = 'adminstracao@tvgflow.com' AND role = 'admin';

    IF evandro_count > 0 THEN
        RAISE NOTICE '✅ Evandro reverted to STAFF (profissional).';
    ELSE
        RAISE NOTICE '⚠️ Evandro NOT updated or not found.';
    END IF;

    IF admin_count > 0 THEN
        RAISE NOTICE '✅ Administracao set to ADMIN.';
    ELSE
        RAISE NOTICE '⚠️ Administracao NOT updated or not found. Check if the user exists in the database.';
    END IF;
END $$;

COMMIT;
