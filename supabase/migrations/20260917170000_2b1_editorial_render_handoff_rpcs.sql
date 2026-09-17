-- 2B.1 / Migration 6: the read-then-attach handoff a future dispatch worker
-- (2B.2) uses to hand a frozen editorial article to the P0-protected render
-- pipeline. Neither function writes to ap.candidate_news or
-- ap.render_generations — attach only records which candidate a dispatch
-- worker already created elsewhere, after validating it belongs to the same
-- tenant and is genuinely new. Both are service_role-only, reusing the P0
-- worker guard rather than duplicating it.
BEGIN;

CREATE FUNCTION ap.claim_editorial_article_for_render(p_article_id uuid)
RETURNS TABLE(
    article_id uuid,
    cliente_id uuid,
    responsible_user_id uuid,
    author_user_id uuid,
    origin_type text,
    origin_reference text,
    production_input_type text,
    content_type text,
    visual_model text,
    visual_title_id uuid,
    region_id uuid,
    city_id uuid,
    manual_slots jsonb,
    source_image_url text,
    headline text,
    body text,
    candidate_news_id uuid,
    status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_article ap.editorial_articles%ROWTYPE;
BEGIN
    PERFORM ap_private.require_p0_worker();

    SELECT * INTO v_article FROM ap.editorial_articles WHERE id = p_article_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_article.status NOT IN ('ready_for_render', 'dispatched') THEN
        RAISE EXCEPTION 'ARTICLE_NOT_READY_FOR_RENDER' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT
        v_article.id, v_article.cliente_id, v_article.responsible_user_id, v_article.author_user_id,
        v_article.origin_type, v_article.origin_reference, v_article.production_input_type,
        v_article.content_type, v_article.visual_model, v_article.visual_title_id,
        v_article.region_id, v_article.city_id, v_article.manual_slots, v_article.source_image_url,
        rev.headline, rev.body,
        v_article.candidate_news_id, v_article.status
    FROM ap.editorial_article_revisions rev
    WHERE rev.article_id = v_article.id
    ORDER BY rev.revision_number DESC
    LIMIT 1;
END;
$function$;

CREATE FUNCTION ap.attach_editorial_article_candidate(p_article_id uuid, p_candidate_news_id uuid)
RETURNS ap.editorial_articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_article ap.editorial_articles%ROWTYPE;
    v_candidate ap.candidate_news%ROWTYPE;
BEGIN
    PERFORM ap_private.require_p0_worker();
    IF p_candidate_news_id IS NULL THEN RAISE EXCEPTION 'CANDIDATE_NEWS_ID_REQUIRED' USING ERRCODE = '22023'; END IF;

    SELECT * INTO v_article FROM ap.editorial_articles WHERE id = p_article_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

    IF v_article.status = 'dispatched' THEN
        IF v_article.candidate_news_id IS DISTINCT FROM p_candidate_news_id THEN
            RAISE EXCEPTION 'CANDIDATE_MISMATCH' USING ERRCODE = '42501';
        END IF;
        RETURN v_article;
    END IF;
    IF v_article.status <> 'ready_for_render' THEN
        RAISE EXCEPTION 'ARTICLE_NOT_READY_FOR_RENDER' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_candidate FROM ap.candidate_news WHERE id = p_candidate_news_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CANDIDATE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_candidate.cliente_id <> v_article.cliente_id THEN RAISE EXCEPTION 'CANDIDATE_TENANT_MISMATCH' USING ERRCODE = '42501'; END IF;
    IF v_candidate.status NOT IN ('processing', 'pending_render') THEN
        RAISE EXCEPTION 'CANDIDATE_NOT_FRESH' USING ERRCODE = '42501';
    END IF;
    -- Belt and suspenders with editorial_articles_candidate_news_id_key: a
    -- clear application error instead of a raw unique_violation.
    IF EXISTS (
        SELECT 1 FROM ap.editorial_articles other
        WHERE other.candidate_news_id = p_candidate_news_id AND other.id <> v_article.id
    ) THEN
        RAISE EXCEPTION 'CANDIDATE_ALREADY_ATTACHED' USING ERRCODE = '42501';
    END IF;

    UPDATE ap.editorial_articles
       SET candidate_news_id = p_candidate_news_id,
           dispatched_at = now(),
           status = 'dispatched',
           updated_at = now()
     WHERE id = v_article.id
     RETURNING * INTO v_article;

    INSERT INTO ap.editorial_article_events (
        article_id, cliente_id, actor_user_id, actor_kind, action, metadata
    ) VALUES (
        v_article.id, v_article.cliente_id, NULL, 'service', 'render_dispatched',
        jsonb_build_object('candidate_news_id', p_candidate_news_id)
    );

    RETURN v_article;
END;
$function$;

REVOKE ALL ON FUNCTION ap.claim_editorial_article_for_render(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ap.attach_editorial_article_candidate(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ap.claim_editorial_article_for_render(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION ap.attach_editorial_article_candidate(uuid, uuid) TO service_role;

COMMIT;
