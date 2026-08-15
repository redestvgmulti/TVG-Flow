-- Employee material delivery must use the same operational tenant contract as
-- the generator. Keep the public views as security_invoker and repair the base
-- table policies instead of bypassing RLS through a view.
DROP POLICY IF EXISTS ap_news_tenant_isolation ON ap.candidate_news;

CREATE POLICY ap_news_select_operational_client
    ON ap.candidate_news
    FOR SELECT TO authenticated
    USING (
        cliente_id IN (SELECT ap.get_user_cliente_ids())
        OR (
            criado_por_user_id = (SELECT auth.uid())
            AND cliente_id IN (SELECT ap.get_operational_cliente_ids())
        )
    );

-- Direct client administrators retain the write permissions from the former
-- ALL policy. Operational employees write only through narrowly scoped RPCs.
CREATE POLICY ap_news_insert_direct_client
    ON ap.candidate_news
    FOR INSERT TO authenticated
    WITH CHECK (cliente_id IN (SELECT ap.get_user_cliente_ids()));

CREATE POLICY ap_news_update_direct_client
    ON ap.candidate_news
    FOR UPDATE TO authenticated
    USING (cliente_id IN (SELECT ap.get_user_cliente_ids()))
    WITH CHECK (cliente_id IN (SELECT ap.get_user_cliente_ids()));

CREATE POLICY ap_news_delete_direct_client
    ON ap.candidate_news
    FOR DELETE TO authenticated
    USING (cliente_id IN (SELECT ap.get_user_cliente_ids()));

CREATE INDEX IF NOT EXISTS idx_candidate_news_creator_generated
    ON ap.candidate_news (criado_por_user_id, gerado_em DESC)
    WHERE criado_por_user_id IS NOT NULL;

-- An employee can acknowledge only their own generated material. These usage
-- actions are audit flags, not editorial states, so this RPC never mutates the
-- candidate status.
CREATE OR REPLACE FUNCTION ap.record_employee_material_action(
    p_candidate_id uuid,
    p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap, public, pg_temp
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_cliente_id uuid;
    v_creator_id uuid;
    v_downloaded boolean;
    v_copied boolean;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
    END IF;

    IF p_action NOT IN ('download', 'copy') THEN
        RAISE EXCEPTION 'ACTION_INVALID' USING ERRCODE = '22023';
    END IF;

    SELECT candidate.cliente_id, candidate.criado_por_user_id
      INTO v_cliente_id, v_creator_id
      FROM ap.candidate_news AS candidate
     WHERE candidate.id = p_candidate_id
     FOR UPDATE;

    IF NOT FOUND OR v_creator_id IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION 'MATERIAL_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM ap.get_operational_cliente_ids() AS allowed(cliente_id)
         WHERE allowed.cliente_id = v_cliente_id
    ) THEN
        RAISE EXCEPTION 'MATERIAL_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    UPDATE ap.candidate_news AS candidate
       SET acao_baixou = candidate.acao_baixou OR p_action = 'download',
           acao_copiou = candidate.acao_copiou OR p_action = 'copy'
     WHERE candidate.id = p_candidate_id
     RETURNING candidate.acao_baixou, candidate.acao_copiou
          INTO v_downloaded, v_copied;

    RETURN jsonb_build_object(
        'candidate_id', p_candidate_id,
        'downloaded', v_downloaded,
        'copied', v_copied,
        'ready_for_use', v_downloaded AND v_copied
    );
END;
$$;

REVOKE ALL ON FUNCTION ap.record_employee_material_action(uuid, text)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.record_employee_material_action(uuid, text)
TO authenticated;

-- Render updates are delivered on one private topic per creator and candidate.
-- The browser still performs a tenant-scoped read after the notification, so
-- the broadcast is a low-latency signal rather than an authorization boundary.
CREATE OR REPLACE FUNCTION ap.broadcast_employee_material_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap, realtime, pg_temp
AS $$
BEGIN
    IF NEW.criado_por_user_id IS NULL OR NOT (
        NEW.status IS DISTINCT FROM OLD.status OR
        NEW.render_url IS DISTINCT FROM OLD.render_url OR
        NEW.error_log IS DISTINCT FROM OLD.error_log OR
        NEW.render_completed_at IS DISTINCT FROM OLD.render_completed_at
    ) THEN
        RETURN NULL;
    END IF;

    PERFORM realtime.broadcast_changes(
        'employee-material:' || NEW.criado_por_user_id::text || ':' || NEW.id::text,
        'material_changed',
        TG_OP,
        TG_TABLE_NAME,
        TG_TABLE_SCHEMA,
        NEW,
        OLD
    );

    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION ap.broadcast_employee_material_change()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS candidate_news_employee_material_broadcast
ON ap.candidate_news;

CREATE TRIGGER candidate_news_employee_material_broadcast
    AFTER UPDATE OF status, render_url, error_log, render_completed_at
    ON ap.candidate_news
    FOR EACH ROW
    EXECUTE FUNCTION ap.broadcast_employee_material_change();

DROP POLICY IF EXISTS employee_material_broadcast_select
ON realtime.messages;

CREATE POLICY employee_material_broadcast_select
    ON realtime.messages
    FOR SELECT TO authenticated
    USING (
        extension = 'broadcast'
        AND split_part((SELECT realtime.topic()), ':', 1) = 'employee-material'
        AND split_part((SELECT realtime.topic()), ':', 2) = (SELECT auth.uid())::text
    );
