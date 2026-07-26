\set ON_ERROR_STOP on

-- Production-only read gate. This file performs no writes and is intentionally
-- excluded from run-sql-contracts.sh, whose target is the disposable local DB.
DO $$
DECLARE
    v_total integer;
    v_enabled integer;
BEGIN
    SELECT count(*), count(*) FILTER (WHERE enabled)
    INTO v_total, v_enabled
    FROM ap.master_render_configs
    WHERE cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9';

    IF v_total <> 4 OR v_enabled <> 0 THEN
        RAISE EXCEPTION
            'production master gate failed: expected 4 total / 0 enabled, got % / %',
            v_total,
            v_enabled;
    END IF;
END;
$$;

\echo 'production-masters-disabled-readonly.sql: PASS'
