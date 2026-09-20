-- Preserve an image discovered by ap-link-scraper even when collected_news
-- already had enough text. The raw collected image remains immutable inside
-- source_metadata.original_image_url; source_image_url is the usable production
-- image that can later be selected explicitly by the human for Placid.
BEGIN;

CREATE OR REPLACE FUNCTION ap.capture_collected_news_article_source(
    p_article_id uuid,
    p_collected_news_id uuid,
    p_scraped_title text,
    p_scraped_body text,
    p_scraped_image_url text,
    p_request_id uuid
)
RETURNS ap.editorial_article_sources
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_cliente_id uuid;
    v_article ap.editorial_articles%ROWTYPE;
    v_backlog ap.news_backlog%ROWTYPE;
    v_collected ap.collected_news%ROWTYPE;
    v_source ap.editorial_article_sources%ROWTYPE;
    v_source_name text;
    v_source_sufficient boolean;
    v_title text;
    v_body text;
    v_image text;
    v_collected_image text;
    v_scraped_image text;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_collected_news_id IS NULL OR p_request_id IS NULL THEN
        RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023';
    END IF;
    v_cliente_id := public.require_single_operational_cliente_id();
    PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);

    SELECT * INTO v_article FROM ap.editorial_articles
    WHERE id = p_article_id AND cliente_id = v_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_article.responsible_user_id IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF v_article.origin_type <> 'news_backlog' OR v_article.news_backlog_id IS NULL THEN
        RAISE EXCEPTION 'EDITORIAL_SOURCE_TYPE_MISMATCH' USING ERRCODE = '22023';
    END IF;
    IF v_article.status NOT IN ('draft', 'editing', 'changes_requested') THEN
        RAISE EXCEPTION 'ARTICLE_NOT_EDITABLE' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_source FROM ap.editorial_article_sources
    WHERE article_id = v_article.id;
    IF FOUND THEN RETURN v_source; END IF;

    SELECT * INTO v_backlog FROM ap.news_backlog
    WHERE id = v_article.news_backlog_id AND cliente_id = v_cliente_id FOR UPDATE;
    IF NOT FOUND OR v_backlog.adopted_by_user_id IS DISTINCT FROM v_user_id THEN
        RAISE EXCEPTION 'BACKLOG_NOT_OWNED' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_collected FROM ap.collected_news
    WHERE id = p_collected_news_id
      AND cliente_id = v_cliente_id
      AND normalized_url = v_backlog.normalized_url
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTED_NEWS_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    SELECT source.nome INTO v_source_name FROM ap.sources AS source WHERE source.id = v_collected.source_id;

    v_source_sufficient := length(btrim(COALESCE(v_collected.content, ''))) >= 200;
    v_collected_image := NULLIF(btrim(v_collected.image_url), '');
    v_scraped_image := NULLIF(btrim(p_scraped_image_url), '');
    -- Prefer the secure scraper result over an insecure collected URL. This
    -- prevents mixed-content in the editor while preserving the raw URL below.
    v_image := CASE
        WHEN v_collected_image ~* '^https://' THEN v_collected_image
        WHEN v_scraped_image ~* '^https://' THEN v_scraped_image
        ELSE NULL
    END;

    IF v_source_sufficient THEN
        v_title := NULLIF(btrim(v_collected.title), '');
        v_body := NULLIF(btrim(v_collected.content), '');
    ELSE
        v_title := COALESCE(NULLIF(btrim(p_scraped_title), ''), NULLIF(btrim(v_collected.title), ''));
        v_body := NULLIF(btrim(p_scraped_body), '');
        IF v_body IS NULL OR length(v_body) < 80 THEN
            RAISE EXCEPTION 'COLLECTED_NEWS_SCRAPE_REQUIRED' USING ERRCODE = '22023';
        END IF;
    END IF;

    INSERT INTO ap.editorial_article_sources (
        article_id, cliente_id, source_type, source_url, source_title,
        source_body, source_image_url, source_backlog_id,
        source_collected_news_id, source_name, source_published_at,
        source_collected_at, source_metadata, captured_by_user_id, request_id
    ) VALUES (
        v_article.id, v_cliente_id, 'news_backlog', v_collected.canonical_url,
        v_title, v_body, v_image, v_backlog.id, v_collected.id, v_source_name,
        v_collected.published_at, v_collected.collected_at,
        jsonb_build_object(
            'source_id', v_collected.source_id,
            'url_original', v_collected.url_original,
            'canonical_url', v_collected.canonical_url,
            'original_title', v_collected.title,
            'original_excerpt', v_collected.excerpt,
            'original_content', v_collected.content,
            'original_image_url', v_collected.image_url,
            'scraped_image_url', v_scraped_image,
            'published_at', v_collected.published_at,
            'collected_at', v_collected.collected_at,
            'last_seen_at', v_collected.last_seen_at,
            'parser_version', v_collected.parser_version,
            'collected_metadata', v_collected.metadata,
            'content_origin', CASE WHEN v_source_sufficient THEN 'collected_news' ELSE 'ap-link-scraper' END,
            'image_origin', CASE
                WHEN v_image IS NULL THEN 'none'
                WHEN v_image IS NOT DISTINCT FROM v_scraped_image THEN 'ap-link-scraper'
                ELSE 'collected_news'
            END
        ),
        v_user_id, p_request_id
    ) RETURNING * INTO v_source;

    INSERT INTO ap.editorial_article_events (
        article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
    ) VALUES (
        v_article.id, v_cliente_id, v_user_id, 'user', 'source_captured',
        jsonb_build_object(
            'source_type', 'news_backlog',
            'backlog_id', v_backlog.id,
            'collected_news_id', v_collected.id,
            'content_origin', CASE WHEN v_source_sufficient THEN 'collected_news' ELSE 'ap-link-scraper' END,
            'image_origin', CASE
                WHEN v_image IS NULL THEN 'none'
                WHEN v_image IS NOT DISTINCT FROM v_scraped_image THEN 'ap-link-scraper'
                ELSE 'collected_news'
            END,
            'has_image', v_image IS NOT NULL
        ), p_request_id
    );

    RETURN v_source;
END;
$function$;

REVOKE ALL ON FUNCTION ap.capture_collected_news_article_source(uuid, uuid, text, text, text, uuid)
    FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.capture_collected_news_article_source(uuid, uuid, text, text, text, uuid)
    TO authenticated;

COMMENT ON FUNCTION ap.capture_collected_news_article_source(uuid, uuid, text, text, text, uuid) IS
    'Captures one append-only collected source and preserves a secure scraper image independently from text sufficiency.';

COMMIT;
