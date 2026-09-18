-- Post-2B.2.3 integrated audit / Migration: fix two findings from
-- docs/2b-integrated-readiness-report.md before any tenant pilot.
--
-- 1. ap.list_my_editorial_articles had an early-return gating on the
--    tenant's editorial_workflow_v1_enabled flag: `IF NOT EXISTS (... flag
--    ON ...) THEN RETURN; END IF;`. That means turning the flag OFF made
--    every already-existing editorial article invisible to both its author
--    and the tenant's admin -- not just new creation, which is what the
--    flag is actually meant to gate (every write RPC already calls
--    ap.assert_editorial_workflow_v1_enabled independently; this read path
--    never needed its own copy of that gate). Confirmed empirically: an
--    article created and drafted while the flag was ON became unlistable
--    the moment the flag was turned OFF, even though
--    get_editorial_article_for_edit could still open it directly by id --
--    the data was never lost, just undiscoverable. Fix: remove the
--    early-return. Same signature (p_cliente_id uuid DEFAULT NULL) as the
--    version being replaced, so CREATE OR REPLACE preserves existing grants
--    and no DROP FUNCTION/new GRANT is needed for this half of the fix.
--    Every other rule in the function (admin sees all of the tenant, staff
--    sees only their own, abandoned excluded, LEFT JOIN so direct-origin
--    articles are included) is unchanged from
--    20260917181500_2b2_editorial_admin_tenant_visibility.sql.
--
-- 2. ap.save_editorial_article_draft and ap.finalize_editorial_article, in
--    their current 5-argument form (headline, body, request_id, and the
--    expected_revision_number widened onto the original 4-arg R1 shape by
--    20260917154500_2b1_editorial_state_machine_expansion.sql), were
--    created via DROP FUNCTION + CREATE OR REPLACE with a *new* argument
--    list. PostgreSQL grants EXECUTE to PUBLIC by default on a newly
--    created function; that migration never revoked it for these two, so
--    both ended up callable by anon/PUBLIC (confirmed empirically:
--    has_function_privilege('anon', ..., 'EXECUTE') = true), unlike every
--    other RPC in this domain, all of which explicitly revoke PUBLIC/anon/
--    service_role before granting to authenticated. Exploitability is low
--    (auth.uid() is NULL for anon, so both functions immediately raise
--    AUTH_REQUIRED before touching any data), but it breaks this stack's
--    otherwise-universal defense-in-depth convention. Fix: add the missing
--    REVOKE/GRANT pair. No function body changes at all for this half.
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

    -- No editorial_feature_flags check here: the flag gates entry into new
    -- creation (already enforced independently by every write RPC via
    -- ap.assert_editorial_workflow_v1_enabled), not visibility of work that
    -- already exists. Turning the flag off must never make an in-flight
    -- article undiscoverable to the people who can already act on it.
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

REVOKE ALL ON FUNCTION ap.save_editorial_article_draft(uuid, text, text, uuid, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.save_editorial_article_draft(uuid, text, text, uuid, integer) TO authenticated;

REVOKE ALL ON FUNCTION ap.finalize_editorial_article(uuid, text, text, uuid, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.finalize_editorial_article(uuid, text, text, uuid, integer) TO authenticated;

COMMENT ON FUNCTION ap.list_my_editorial_articles(uuid) IS
    'Post-2B.2.3 audit fix: visibility of existing articles is never gated by editorial_workflow_v1_enabled -- only creation/writes are (via assert_editorial_workflow_v1_enabled in every mutating RPC). Admin sees all of the tenant, staff sees only their own, abandoned excluded.';

COMMIT;
