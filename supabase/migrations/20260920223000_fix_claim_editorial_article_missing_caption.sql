-- Bug: claim_editorial_article_for_render() only exposed rev.headline and
-- rev.body from the latest editorial_article_revisions row, silently
-- dropping rev.caption (the actual social caption with hashtags + source
-- attribution that the editorial AI generates separately from the plain
-- article body). ap-editorial-render-dispatch then had no real caption to
-- use, so canonicalEditorialFields() fell back to whatever placeholder
-- caption create_candidate_with_sponsors had already set (== the body
-- text), and every candidate produced through this path lost its hashtags.
-- Return type change requires DROP + CREATE (not OR REPLACE).

DROP FUNCTION ap.claim_editorial_article_for_render(uuid);

CREATE FUNCTION ap.claim_editorial_article_for_render(p_article_id uuid)
 RETURNS TABLE(article_id uuid, cliente_id uuid, responsible_user_id uuid, author_user_id uuid, origin_type text, origin_reference text, production_input_type text, content_type text, visual_model text, visual_title_id uuid, region_id uuid, city_id uuid, manual_slots jsonb, source_image_url text, headline text, body text, caption text, candidate_news_id uuid, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
        rev.headline, rev.body, rev.caption,
        v_article.candidate_news_id, v_article.status
    FROM ap.editorial_article_revisions rev
    WHERE rev.article_id = v_article.id
    ORDER BY rev.revision_number DESC
    LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION ap.claim_editorial_article_for_render(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ap.claim_editorial_article_for_render(uuid) TO postgres, service_role;
