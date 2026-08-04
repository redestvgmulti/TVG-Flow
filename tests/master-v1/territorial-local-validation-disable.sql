\set ON_ERROR_STOP on

-- Reversible local kill switch. Data created during visual validation is
-- intentionally preserved; disabling the flag hides the UI and blocks every
-- territorial mutation RPC.

UPDATE ap.system_config
SET territorial_admin_enabled = false
WHERE cliente_id = public.get_agencia_cliente_id();

SELECT
    cliente_id,
    territorial_admin_enabled
FROM ap.system_config
WHERE cliente_id = public.get_agencia_cliente_id();

\echo 'territorial-local-validation-disable.sql: PASS'
