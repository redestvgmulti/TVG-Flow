-- 2B.2.1 / Migration: restore the admin-sees-all-tenant-articles branch that
-- R1's original zero-arg ap.list_my_editorial_articles() had
-- (r1_editorial_domain_rpcs.sql), which was lost by accident in the 2B.1
-- migration that fixed the INNER JOIN bug excluding direct-origin articles
-- (2b1_editorial_state_machine_expansion.sql): that fix was based on R1's
-- migration 4 body (ap.list_my_editorial_articles(p_cliente_id), which
-- always filters by responsible_user_id regardless of role), not migration
-- 3's admin-aware body. Net effect: today an admin calling this RPC sees
-- only their own articles, same as staff -- which 2B.2's admin work panel
-- (EditorialWorkPanel, upcoming in 2B.2.3) needs to not be true.
--
-- This does not touch the already-committed 2B.1 migration file. Same
-- signature (p_cliente_id uuid DEFAULT NULL) as the one it replaces, so
-- CREATE OR REPLACE swaps the body in place; no DROP FUNCTION needed since
-- the arity is unchanged from the version being corrected.
BEGIN;

CREATE OR REPLACE FUNCTION ap.list_my_editorial_articles(p_cliente_id uuid DEFAULT NULL)
RETURNS TABLE(
    id uuid,
    article_id uuid,
    news_backlog_id uuid,
    status text,
    responsible_user_id uuid,
    responsible_name text,
    headline text,
    url_original text,
    observacao text,
    created_at timestamptz,
    updated_at timestamptz,
    first_finalized_at timestamptz,
    finalized_at timestamptz,
    origem_editorial text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_cliente_id uuid;
    v_role text;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    v_cliente_id := public.require_single_operational_cliente_id();
    SELECT p.role INTO v_role
      FROM public.profissionais p
     WHERE p.id = v_user_id AND p.ativo IS TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM ap.editorial_feature_flags flag
        WHERE flag.cliente_id = v_cliente_id
          AND flag.editorial_workflow_v1_enabled IS TRUE
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        article.id AS id,
        article.id AS article_id,
        article.news_backlog_id,
        article.status,
        article.responsible_user_id,
        article.responsible_name_snapshot AS responsible_name,
        COALESCE(
            (SELECT rev.headline
             FROM ap.editorial_article_revisions rev
             WHERE rev.article_id = article.id
             ORDER BY rev.revision_number DESC
             LIMIT 1),
            backlog.titulo
        ) AS headline,
        backlog.url_original,
        backlog.observacao,
        article.created_at,
        article.updated_at,
        article.first_finalized_at,
        article.finalized_at,
        'editorial'::text AS origem_editorial
    FROM ap.editorial_articles article
    LEFT JOIN ap.news_backlog backlog ON backlog.id = article.news_backlog_id
    WHERE article.cliente_id = v_cliente_id
      AND (v_role = 'admin' OR article.responsible_user_id = v_user_id)
      AND article.status <> 'abandoned'
    ORDER BY
        CASE article.status
            WHEN 'draft' THEN 0
            WHEN 'editing' THEN 1
            WHEN 'changes_requested' THEN 1
            WHEN 'content_final' THEN 2
            WHEN 'ready_for_render' THEN 3
            WHEN 'dispatched' THEN 4
            ELSE 5
        END,
        article.updated_at DESC,
        article.id DESC;
END;
$function$;

COMMIT;
