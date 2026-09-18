-- 2B.1 / Migration 5: the editorial review gate. An admin either sends a
-- finalized article back for changes, or approves it for render, which is
-- the explicit "esta revisão está pronta para gerar arte" freeze moment.
-- Once ready_for_render, no RPC in this migration set can change the
-- production/content fields again (enforced by ap.claim_editorial_article_for_render
-- and ap.attach_editorial_article_candidate only reading, never writing them).
BEGIN;

-- Defense in depth, matching the P0 pattern: the RPCs above already refuse
-- to touch a frozen article, but a database trigger means that guarantee
-- does not depend on every future write path remembering to check status
-- first. Once ready_for_render/dispatched, only the single
-- ready_for_render -> dispatched transition (setting candidate_news_id
-- exactly once) is allowed; everything else about the article is frozen.
CREATE FUNCTION ap.guard_editorial_article_freeze() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
    IF OLD.status NOT IN ('ready_for_render', 'dispatched') THEN
        RETURN NEW;
    END IF;
    IF NEW.origin_type IS DISTINCT FROM OLD.origin_type
       OR NEW.origin_reference IS DISTINCT FROM OLD.origin_reference
       OR NEW.production_input_type IS DISTINCT FROM OLD.production_input_type
       OR NEW.content_type IS DISTINCT FROM OLD.content_type
       OR NEW.visual_model IS DISTINCT FROM OLD.visual_model
       OR NEW.visual_title_id IS DISTINCT FROM OLD.visual_title_id
       OR NEW.region_id IS DISTINCT FROM OLD.region_id
       OR NEW.city_id IS DISTINCT FROM OLD.city_id
       OR NEW.manual_slots IS DISTINCT FROM OLD.manual_slots
       OR NEW.source_image_url IS DISTINCT FROM OLD.source_image_url
       OR NEW.responsible_user_id IS DISTINCT FROM OLD.responsible_user_id
       OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
       OR NEW.news_backlog_id IS DISTINCT FROM OLD.news_backlog_id
    THEN
        RAISE EXCEPTION 'EDITORIAL_ARTICLE_FROZEN' USING ERRCODE = '55000';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'ready_for_render' AND NEW.status = 'dispatched') THEN
        RAISE EXCEPTION 'EDITORIAL_ARTICLE_FROZEN' USING ERRCODE = '55000';
    END IF;
    IF OLD.candidate_news_id IS NOT NULL AND NEW.candidate_news_id IS DISTINCT FROM OLD.candidate_news_id THEN
        RAISE EXCEPTION 'EDITORIAL_ARTICLE_FROZEN' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER editorial_article_freeze BEFORE UPDATE ON ap.editorial_articles
FOR EACH ROW EXECUTE FUNCTION ap.guard_editorial_article_freeze();

CREATE FUNCTION ap.request_editorial_article_changes(
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
    v_actor record;
    v_article ap.editorial_articles%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023'; END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'EDITORIAL_REASON_REQUIRED' USING ERRCODE = '22023'; END IF;

    v_cliente_id := public.require_single_operational_cliente_id();
    PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);
    SELECT * INTO v_actor FROM ap.require_editorial_admin_access(v_cliente_id);

    SELECT * INTO v_article FROM ap.editorial_articles
    WHERE id = p_article_id AND cliente_id = v_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
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
        v_article.id, v_cliente_id, v_actor.user_id, 'user', 'changes_requested',
        jsonb_build_object('reason', btrim(p_reason)), p_request_id
    );

    RETURN v_article;
END;
$function$;

CREATE FUNCTION ap.approve_editorial_article_for_render(
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
    v_actor record;
    v_article ap.editorial_articles%ROWTYPE;
    v_current_revision_number integer;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023'; END IF;

    v_cliente_id := public.require_single_operational_cliente_id();
    PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);
    SELECT * INTO v_actor FROM ap.require_editorial_admin_access(v_cliente_id);

    SELECT * INTO v_article FROM ap.editorial_articles
    WHERE id = p_article_id AND cliente_id = v_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF EXISTS (
        SELECT 1 FROM ap.editorial_article_events
        WHERE article_id = v_article.id AND action = 'approved_for_render' AND request_id = p_request_id
    ) THEN RETURN v_article; END IF;
    IF v_article.status <> 'content_final' THEN RAISE EXCEPTION 'ARTICLE_NOT_UNDER_REVIEW' USING ERRCODE = '42501'; END IF;
    IF v_article.content_type IS NULL THEN RAISE EXCEPTION 'PRODUCTION_INTENT_REQUIRED' USING ERRCODE = '42501'; END IF;

    -- The reviewer must be looking at the exact revision they are approving.
    SELECT max(revision_number) INTO v_current_revision_number
    FROM ap.editorial_article_revisions WHERE article_id = v_article.id;
    IF p_expected_revision_number IS DISTINCT FROM v_current_revision_number THEN
        RAISE EXCEPTION 'EDITORIAL_REVISION_CONFLICT' USING ERRCODE = '40001';
    END IF;

    UPDATE ap.editorial_articles
       SET status = 'ready_for_render',
           reviewed_by_user_id = v_actor.user_id,
           reviewed_by_name_snapshot = v_actor.display_name,
           ready_for_render_at = now(),
           updated_at = now()
     WHERE id = v_article.id RETURNING * INTO v_article;

    INSERT INTO ap.editorial_article_events (
        article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
    ) VALUES (
        v_article.id, v_cliente_id, v_actor.user_id, 'user', 'approved_for_render',
        jsonb_build_object('revision_number', v_current_revision_number), p_request_id
    );

    RETURN v_article;
END;
$function$;

REVOKE ALL ON FUNCTION ap.request_editorial_article_changes(uuid, text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION ap.approve_editorial_article_for_render(uuid, integer, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.request_editorial_article_changes(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.approve_editorial_article_for_render(uuid, integer, uuid) TO authenticated;

COMMIT;
