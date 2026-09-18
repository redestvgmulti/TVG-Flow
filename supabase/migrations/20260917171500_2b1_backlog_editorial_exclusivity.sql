-- 2B.1 / Migration 7: close the exclusivity gap between the legacy backlog
-- production path and the R1 editorial domain. R1's own
-- start_editorial_article_from_backlog already refuses a backlog item the
-- legacy path already linked to a candidate (BACKLOG_LEGACY_CANDIDATE_LINKED).
-- The opposite direction was open: the legacy gate/link functions below
-- (unchanged since 17-27/08, before ap.editorial_articles existed) had no
-- idea the new domain could already be claiming the same backlog row. Both
-- bodies are reproduced verbatim from their current definitions
-- (ap.assert_news_backlog_production_access, 20260817150000; the latest
-- ap.link_news_backlog_candidate, 20260827172413) with only the exclusivity
-- guard added.
BEGIN;

CREATE OR REPLACE FUNCTION ap.assert_news_backlog_production_access(
    p_backlog_id uuid,
    p_cliente_id uuid,
    p_url_original text
)
RETURNS ap.news_backlog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap, public, pg_temp
AS $function$
DECLARE
    v_actor record;
    v_result ap.news_backlog%ROWTYPE;
    v_url text := btrim(COALESCE(p_url_original, ''));
BEGIN
    SELECT * INTO v_actor FROM ap.require_news_backlog_access(p_cliente_id);

    IF EXISTS (
        SELECT 1 FROM ap.editorial_articles article
        WHERE article.news_backlog_id = p_backlog_id AND article.status <> 'abandoned'
    ) THEN
        RAISE EXCEPTION 'BACKLOG_EDITORIAL_ARTICLE_ACTIVE' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_result
    FROM ap.news_backlog AS backlog
    WHERE backlog.id = p_backlog_id
      AND backlog.cliente_id = p_cliente_id
      AND backlog.status = 'adopted'
      AND backlog.adopted_by_user_id = v_actor.user_id
      AND backlog.candidate_news_id IS NULL
      AND backlog.url_original = v_url;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BACKLOG_PRODUCTION_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION ap.link_news_backlog_candidate(
    p_backlog_id uuid,
    p_cliente_id uuid,
    p_candidate_id uuid,
    p_actor_user_id uuid,
    p_url_original text
)
RETURNS ap.news_backlog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_result ap.news_backlog%ROWTYPE;
    v_url text := btrim(COALESCE(p_url_original, ''));
BEGIN
    IF session_user <> 'postgres'
       AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
        SELECT 1 FROM ap.editorial_articles article
        WHERE article.news_backlog_id = p_backlog_id AND article.status <> 'abandoned'
    ) THEN
        RAISE EXCEPTION 'BACKLOG_EDITORIAL_ARTICLE_ACTIVE' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM ap.candidate_news candidate
        WHERE candidate.id = p_candidate_id
          AND candidate.cliente_id = p_cliente_id
          AND candidate.criado_por_user_id = p_actor_user_id
          AND candidate.url_original = v_url
    ) THEN
        RAISE EXCEPTION 'BACKLOG_CANDIDATE_MISMATCH' USING ERRCODE = '42501';
    END IF;

    UPDATE ap.news_backlog AS backlog
       SET candidate_news_id = p_candidate_id,
           production_started_at = COALESCE(backlog.production_started_at, now()),
           status = 'in_production'
     WHERE backlog.id = p_backlog_id
       AND backlog.cliente_id = p_cliente_id
       AND backlog.status IN ('adopted', 'in_production')
       AND backlog.adopted_by_user_id = p_actor_user_id
       AND backlog.url_original = v_url
       AND (backlog.candidate_news_id IS NULL OR backlog.candidate_news_id = p_candidate_id)
     RETURNING * INTO v_result;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BACKLOG_LINK_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    INSERT INTO ap.news_backlog_events (backlog_id, cliente_id, actor_user_id, action, metadata)
    SELECT v_result.id, p_cliente_id, p_actor_user_id, 'production_started',
           jsonb_build_object('candidate_news_id', p_candidate_id)
    WHERE NOT EXISTS (
        SELECT 1 FROM ap.news_backlog_events event
        WHERE event.backlog_id = v_result.id
          AND event.action = 'production_started'
          AND event.metadata ->> 'candidate_news_id' = p_candidate_id::text
    );
    RETURN v_result;
END;
$function$;

COMMIT;
