-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1025: Fix User Role for Evandro
-- Date: 2026-01-12
-- Description: Updates the role of user 'evandro@tvgflow.com' to 'admin'.
--              This ensures he sees the Admin Dashboard and 'Criar nova tarefa'.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- Update the role in profissionais table
-- Assuming the table uses 'role' column (based on 001_initial_schema.sql)
UPDATE profissionais
SET role = 'admin'
WHERE email = 'evandro@tvgflow.com';

-- Verify update (raise notice)
DO $$
DECLARE
    rows_updated integer;
BEGIN
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    IF rows_updated > 0 THEN
        RAISE NOTICE '✅ User evandro@tvgflow.com updated to ADMIN.';
    ELSE
        RAISE NOTICE '⚠️ User evandro@tvgflow.com NOT FOUND in professionals table.';
    END IF;
END $$;

COMMIT;
