-- 2B.2.1 / Migration: let a browser-facing user reopen their own draft.
-- ap.get_editorial_article(uuid) only returns the ap.editorial_articles row
-- (no headline/body -- those live in editorial_article_revisions); the three
-- domain tables have REVOKE ALL from every API role, so nothing short of a
-- new RPC can read a draft's own text back. claim_editorial_article_for_render
-- already returns headline/body but is service_role-only and gated to
-- ready_for_render/dispatched -- unusable for an author reopening a plain
-- draft. Purely additive; does not touch any existing migration or RPC.
BEGIN;

CREATE FUNCTION ap.get_editorial_article_for_edit(p_article_id uuid)
RETURNS TABLE(
  id uuid,
  cliente_id uuid,
  status text,
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
  responsible_user_id uuid,
  responsible_name_snapshot text,
  author_user_id uuid,
  headline text,
  body text,
  revision_number integer,
  candidate_news_id uuid,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_cliente_id uuid;
    v_article ap.editorial_articles%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
    END IF;

    v_cliente_id := public.require_single_operational_cliente_id();

    SELECT * INTO v_article
    FROM ap.editorial_articles
    WHERE ap.editorial_articles.id = p_article_id
      AND ap.editorial_articles.cliente_id = v_cliente_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    IF v_article.responsible_user_id <> v_user_id THEN
        BEGIN
            PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id);
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
        END;
    END IF;

    RETURN QUERY
    SELECT
        v_article.id,
        v_article.cliente_id,
        v_article.status,
        v_article.origin_type,
        v_article.origin_reference,
        v_article.production_input_type,
        v_article.content_type,
        v_article.visual_model,
        v_article.visual_title_id,
        v_article.region_id,
        v_article.city_id,
        v_article.manual_slots,
        v_article.source_image_url,
        v_article.responsible_user_id,
        v_article.responsible_name_snapshot,
        v_article.author_user_id,
        rev.headline,
        rev.body,
        rev.revision_number,
        v_article.candidate_news_id,
        v_article.updated_at
    FROM ap.editorial_article_revisions rev
    WHERE rev.article_id = v_article.id
    ORDER BY rev.revision_number DESC
    LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION ap.get_editorial_article_for_edit(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.get_editorial_article_for_edit(uuid) TO authenticated;

COMMENT ON FUNCTION ap.get_editorial_article_for_edit(uuid) IS
    '2B.2.1: browser-facing read of an editorial article plus its latest revision (headline/body/revision_number), for the editor to reopen a draft. Returns nothing if the article has no revision yet (created but never drafted).';

COMMIT;
