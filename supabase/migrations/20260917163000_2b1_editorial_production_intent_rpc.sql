-- 2B.1 / Migration 4: mutate the production-intent fields (format, template
-- purpose, selo, territorial composer inputs, source image) separately from
-- the headline/body draft loop. origin_type/origin_reference are immutable
-- and untouched here — only production_input_type and the format/template
-- selection can change while the article is still editable.
BEGIN;

CREATE FUNCTION ap.save_editorial_article_production_intent(
    p_article_id uuid,
    p_production_input_type text,
    p_content_type text,
    p_visual_model text,
    p_visual_title_id uuid,
    p_region_id uuid,
    p_city_id uuid,
    p_manual_slots jsonb,
    p_source_image_url text,
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
    v_article ap.editorial_articles%ROWTYPE;
    v_source_image text := NULLIF(btrim(p_source_image_url), '');
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023'; END IF;
    IF p_production_input_type NOT IN ('link', 'text', 'image') THEN
        RAISE EXCEPTION 'PRODUCTION_INPUT_TYPE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF p_content_type IS NOT NULL AND p_content_type NOT IN ('feed', 'reels', 'story') THEN
        RAISE EXCEPTION 'CONTENT_TYPE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF v_source_image IS NOT NULL AND v_source_image !~ '^https?://' THEN
        RAISE EXCEPTION 'INVALID_SOURCE_IMAGE' USING ERRCODE = '22023';
    END IF;

    v_cliente_id := public.require_single_operational_cliente_id();
    PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);
    PERFORM 1 FROM public.profissionais WHERE id = v_user_id AND ativo IS TRUE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;

    SELECT * INTO v_article FROM ap.editorial_articles
    WHERE id = p_article_id AND cliente_id = v_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

    IF v_article.responsible_user_id <> v_user_id THEN
        BEGIN
            PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id);
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
        END;
    END IF;
    IF EXISTS (
        SELECT 1 FROM ap.editorial_article_events
        WHERE article_id = v_article.id AND action = 'draft_saved'
          AND request_id = p_request_id AND metadata->>'production_intent' = 'true'
    ) THEN RETURN v_article; END IF;
    IF v_article.status NOT IN ('draft', 'editing', 'changes_requested') THEN
        RAISE EXCEPTION 'ARTICLE_NOT_EDITABLE' USING ERRCODE = '42501';
    END IF;

    UPDATE ap.editorial_articles SET
        production_input_type = p_production_input_type,
        content_type = p_content_type,
        visual_model = p_visual_model,
        visual_title_id = p_visual_title_id,
        region_id = p_region_id,
        city_id = p_city_id,
        manual_slots = p_manual_slots,
        source_image_url = v_source_image,
        updated_at = now()
     WHERE id = v_article.id
     RETURNING * INTO v_article;

    INSERT INTO ap.editorial_article_events (
        article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
    ) VALUES (
        v_article.id, v_cliente_id, v_user_id, 'user', 'draft_saved',
        jsonb_build_object('production_intent', true, 'content_type', p_content_type), p_request_id
    );

    RETURN v_article;
END;
$function$;

REVOKE ALL ON FUNCTION ap.save_editorial_article_production_intent(uuid, text, text, text, uuid, uuid, uuid, jsonb, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.save_editorial_article_production_intent(uuid, text, text, text, uuid, uuid, uuid, jsonb, text, uuid) TO authenticated;

COMMIT;
