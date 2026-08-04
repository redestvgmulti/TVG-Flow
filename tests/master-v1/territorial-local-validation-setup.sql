\set ON_ERROR_STOP on

-- LOCAL/ISOLATED VALIDATION FIXTURE ONLY.
-- It deliberately starts with the territorial flag disabled and never embeds
-- a production tenant UUID. The operational tenant is resolved by the same
-- local RPC used by the AutoPublisher frontend.

BEGIN;

DO $fixture$
DECLARE
    v_cliente_id uuid := public.get_agencia_cliente_id();
BEGIN
    INSERT INTO ap.system_config (
        cliente_id,
        territorial_admin_enabled
    )
    VALUES (
        v_cliente_id,
        false
    )
    ON CONFLICT (cliente_id)
    DO UPDATE
    SET territorial_admin_enabled = false;

    -- The long-lived local database predates the four-group production
    -- catalog. Add only the missing administrative cards required for the
    -- visual regression exercise; existing groups are never rewritten.
    INSERT INTO ap.visual_title_groups (
        cliente_id,
        nome,
        slug,
        descricao,
        ordem,
        ativo
    )
    VALUES
        (
            v_cliente_id,
            'Estados/Mundo',
            'estados-mundo',
            '[LOCAL TERRITORIAL VALIDATION 20260804]',
            30,
            true
        ),
        (
            v_cliente_id,
            'Eventos',
            'eventos',
            '[LOCAL TERRITORIAL VALIDATION 20260804]',
            40,
            true
        )
    ON CONFLICT (cliente_id, slug)
    DO NOTHING;
END;
$fixture$;

COMMIT;

\echo 'territorial-local-validation-setup.sql: PASS (flag disabled)'
