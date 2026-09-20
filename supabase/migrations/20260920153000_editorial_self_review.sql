-- The responsible author reviews their own editorial revision. Tenant admins
-- retain their existing operational review permission for other authors.
BEGIN;

CREATE OR REPLACE FUNCTION ap.request_editorial_article_changes(
    p_article_id uuid,
    p_reason text,
    p_request_id uuid
)
RETURNS ap.editorial_articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_cliente_id uuid;
    v_display_name text;
    v_article ap.editorial_articles%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023'; END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'EDITORIAL_REASON_REQUIRED' USING ERRCODE = '22023'; END IF;

    v_cliente_id := public.require_single_operational_cliente_id();
    PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);
    SELECT COALESCE(NULLIF(btrim(nome), ''), 'Usuário') INTO v_display_name
      FROM public.profissionais WHERE id = v_user_id AND ativo IS TRUE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;

    SELECT * INTO v_article FROM ap.editorial_articles
     WHERE id = p_article_id AND cliente_id = v_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_article.responsible_user_id IS DISTINCT FROM v_user_id THEN
        BEGIN
            PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id);
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
        END;
    END IF;
    IF EXISTS (
        SELECT 1 FROM ap.editorial_article_events
         WHERE article_id = v_article.id AND action = 'changes_requested' AND request_id = p_request_id
    ) THEN RETURN v_article; END IF;
    IF v_article.status <> 'content_final' THEN RAISE EXCEPTION 'ARTICLE_NOT_UNDER_REVIEW' USING ERRCODE = '42501'; END IF;

    UPDATE ap.editorial_articles SET status = 'changes_requested', updated_at = now()
     WHERE id = v_article.id RETURNING * INTO v_article;
    INSERT INTO ap.editorial_article_events (
        article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
    ) VALUES (
        v_article.id, v_cliente_id, v_user_id, 'user', 'changes_requested',
        jsonb_build_object('reason', btrim(p_reason)), p_request_id
    );
    RETURN v_article;
END;
$function$;

CREATE OR REPLACE FUNCTION ap.approve_editorial_article_for_render(
    p_article_id uuid,
    p_expected_revision_number integer,
    p_request_id uuid
)
RETURNS ap.editorial_articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_cliente_id uuid;
    v_display_name text;
    v_article ap.editorial_articles%ROWTYPE;
    v_current_revision_number integer;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023'; END IF;

    v_cliente_id := public.require_single_operational_cliente_id();
    PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);
    SELECT COALESCE(NULLIF(btrim(nome), ''), 'Usuário') INTO v_display_name
      FROM public.profissionais WHERE id = v_user_id AND ativo IS TRUE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;

    SELECT * INTO v_article FROM ap.editorial_articles
     WHERE id = p_article_id AND cliente_id = v_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_article.responsible_user_id IS DISTINCT FROM v_user_id THEN
        BEGIN
            PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id);
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
        END;
    END IF;
    IF EXISTS (
        SELECT 1 FROM ap.editorial_article_events
         WHERE article_id = v_article.id AND action = 'approved_for_render' AND request_id = p_request_id
    ) THEN RETURN v_article; END IF;
    IF v_article.status <> 'content_final' THEN RAISE EXCEPTION 'ARTICLE_NOT_UNDER_REVIEW' USING ERRCODE = '42501'; END IF;
    IF v_article.content_type IS NULL THEN RAISE EXCEPTION 'PRODUCTION_INTENT_REQUIRED' USING ERRCODE = '42501'; END IF;

    SELECT max(revision_number) INTO v_current_revision_number
      FROM ap.editorial_article_revisions WHERE article_id = v_article.id;
    IF p_expected_revision_number IS DISTINCT FROM v_current_revision_number THEN
        RAISE EXCEPTION 'EDITORIAL_REVISION_CONFLICT' USING ERRCODE = '40001';
    END IF;

    UPDATE ap.editorial_articles
       SET status = 'ready_for_render',
           reviewed_by_user_id = v_user_id,
           reviewed_by_name_snapshot = v_display_name,
           ready_for_render_at = now(),
           updated_at = now()
     WHERE id = v_article.id RETURNING * INTO v_article;
    INSERT INTO ap.editorial_article_events (
        article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
    ) VALUES (
        v_article.id, v_cliente_id, v_user_id, 'user', 'approved_for_render',
        jsonb_build_object('revision_number', v_current_revision_number), p_request_id
    );
    RETURN v_article;
END;
$function$;

REVOKE ALL ON FUNCTION ap.request_editorial_article_changes(uuid, text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION ap.approve_editorial_article_for_render(uuid, integer, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.request_editorial_article_changes(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.approve_editorial_article_for_render(uuid, integer, uuid) TO authenticated;

COMMENT ON FUNCTION ap.approve_editorial_article_for_render(uuid, integer, uuid) IS
    'The responsible author reviews their own exact revision; tenant admins retain operational review access.';

-- The rendered asset keeps the P0 generation-specific review. Its creator may
-- perform that review directly; no second person or admin role is required.
CREATE OR REPLACE FUNCTION ap.p0_approve_generation(
    p_candidate_id uuid,
    p_cliente_id uuid,
    p_generation_id uuid,
    p_asset_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    c ap.candidate_news;
    v_user_id uuid := auth.uid();
    v_operational_cliente_id uuid;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    v_operational_cliente_id := public.require_single_operational_cliente_id();
    IF v_operational_cliente_id IS DISTINCT FROM p_cliente_id THEN
        RAISE EXCEPTION 'MATERIAL_REVIEW_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO c FROM ap.candidate_news
     WHERE id = p_candidate_id AND cliente_id = p_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REVIEWED_GENERATION_REQUIRED'; END IF;
    IF c.criado_por_user_id IS DISTINCT FROM v_user_id THEN
        BEGIN
            PERFORM 1 FROM ap.require_editorial_admin_access(v_operational_cliente_id);
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE EXCEPTION 'MATERIAL_REVIEW_FORBIDDEN' USING ERRCODE = '42501';
        END;
    END IF;
    IF c.status <> 'pending_review' OR c.processing_started_at IS NOT NULL
       OR c.current_generation_id IS DISTINCT FROM p_generation_id
       OR NOT EXISTS (
           SELECT 1 FROM ap.render_generations
            WHERE id = p_generation_id AND candidate_id = c.id
              AND status = 'succeeded' AND asset_url = p_asset_url AND asset_url = c.render_url
       ) THEN
        RAISE EXCEPTION 'REVIEWED_GENERATION_REQUIRED';
    END IF;

    INSERT INTO ap_private.p0_capabilities VALUES (txid_current(), c.id, 'approve');
    UPDATE ap.candidate_news
       SET status = 'approved', approved_generation_id = p_generation_id,
           approved_by = v_user_id,
           approved_by_name = COALESCE(
               (SELECT NULLIF(btrim(nome), '') FROM public.profissionais WHERE id = v_user_id),
               'Usuário'
           ),
           approved_at = now()
     WHERE id = c.id;
    DELETE FROM ap_private.p0_capabilities
     WHERE transaction_id = txid_current() AND candidate_id = c.id;
END;
$function$;

REVOKE ALL ON FUNCTION ap.p0_approve_generation(uuid, uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.p0_approve_generation(uuid, uuid, uuid, text) TO authenticated;

COMMENT ON FUNCTION ap.p0_approve_generation(uuid, uuid, uuid, text) IS
    'The candidate creator or a tenant admin may approve the exact succeeded generation and asset reviewed.';

COMMIT;
