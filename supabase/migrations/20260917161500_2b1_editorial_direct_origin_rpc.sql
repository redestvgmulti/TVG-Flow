-- 2B.1 / Migration 3: start an editorial article without an adopted
-- backlog item (Link / Text / Image submitted directly). Mirrors
-- ap.start_editorial_article_from_backlog's auth/tenant/flag pattern, but
-- there is no shared banco-de-pautas row to lock or transition — each call
-- creates its own article.
BEGIN;

CREATE FUNCTION ap.start_editorial_article_direct(
    p_origin_type text,
    p_origin_reference text,
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
    v_actor public.profissionais%ROWTYPE;
    v_article ap.editorial_articles%ROWTYPE;
    v_reference text := NULLIF(btrim(p_origin_reference), '');
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
    END IF;
    IF p_request_id IS NULL THEN
        RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF p_origin_type NOT IN ('link', 'text', 'image') THEN
        RAISE EXCEPTION 'ORIGIN_TYPE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF p_origin_type = 'text' AND v_reference IS NOT NULL THEN
        RAISE EXCEPTION 'ORIGIN_REFERENCE_NOT_ALLOWED' USING ERRCODE = '22023';
    END IF;
    IF p_origin_type IN ('link', 'image') AND (v_reference IS NULL OR v_reference !~ '^https?://') THEN
        RAISE EXCEPTION 'ORIGIN_REFERENCE_URL_REQUIRED' USING ERRCODE = '22023';
    END IF;

    v_cliente_id := public.require_single_operational_cliente_id();
    PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);

    SELECT * INTO v_actor
    FROM public.profissionais
    WHERE id = v_user_id AND ativo IS TRUE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- Idempotent retry: the same request_id always resolves to the same
    -- article rather than creating a duplicate.
    SELECT a.* INTO v_article
    FROM ap.editorial_article_events e
    JOIN ap.editorial_articles a ON a.id = e.article_id
    WHERE e.action = 'article_created' AND e.request_id = p_request_id AND a.cliente_id = v_cliente_id;
    IF FOUND THEN
        RETURN v_article;
    END IF;

    INSERT INTO ap.editorial_articles (
        cliente_id, news_backlog_id, origin_type, origin_reference, production_input_type,
        responsible_user_id, responsible_name_snapshot
    ) VALUES (
        v_cliente_id, NULL, p_origin_type, v_reference, p_origin_type,
        v_user_id, COALESCE(NULLIF(btrim(v_actor.nome), ''), 'Usuário')
    ) RETURNING * INTO v_article;

    INSERT INTO ap.editorial_article_events (
        article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
    ) VALUES (
        v_article.id, v_cliente_id, v_user_id, 'user', 'article_created',
        jsonb_build_object('origin_type', p_origin_type, 'origin_reference', v_reference), p_request_id
    );

    RETURN v_article;
END;
$function$;

REVOKE ALL ON FUNCTION ap.start_editorial_article_direct(text, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.start_editorial_article_direct(text, text, uuid) TO authenticated;

COMMENT ON FUNCTION ap.start_editorial_article_direct(text, text, uuid) IS
    '2B.1: origin_type/origin_reference are fixed at creation and never change; production_input_type starts equal to origin_type but is mutable via ap.save_editorial_article_production_intent.';

COMMIT;
