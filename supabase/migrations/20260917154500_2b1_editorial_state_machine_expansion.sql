-- 2B.1 / Migration 2: widen the R1 status/action vocabulary for the
-- pre-render review loop, add optimistic-concurrency to draft/finalize, and
-- fix a latent bug the nullable news_backlog_id (migration 1) exposes: four
-- existing RPCs locked the backlog row via an INNER JOIN on
-- news_backlog_id, which silently excludes every direct-origin article
-- (news_backlog_id IS NULL). They are recreated here to lock the article
-- row directly and only additionally lock the backlog row when one exists.
-- No candidate_news/render_generations/ap_private object is touched.
BEGIN;

ALTER TABLE ap.editorial_articles DROP CONSTRAINT editorial_articles_status_check;
ALTER TABLE ap.editorial_articles ADD CONSTRAINT editorial_articles_status_check
    CHECK (status IN ('draft', 'editing', 'content_final', 'changes_requested',
                       'ready_for_render', 'dispatched', 'abandoned'));

ALTER TABLE ap.editorial_article_events DROP CONSTRAINT editorial_article_events_action_check;
ALTER TABLE ap.editorial_article_events ADD CONSTRAINT editorial_article_events_action_check
    CHECK (action IN ('article_created', 'draft_saved', 'content_finalized',
                       'article_reopened', 'article_abandoned', 'article_reactivated',
                       'changes_requested', 'approved_for_render', 'render_dispatched'));

-- A new parameter changes the signature; CREATE OR REPLACE would otherwise
-- add a second overload alongside the original 4-arg function instead of
-- replacing it (the exact ambiguity bug this migration set fixes elsewhere
-- in the pre-existing list_my_editorial_articles overloads).
DROP FUNCTION IF EXISTS ap.save_editorial_article_draft(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION ap.save_editorial_article_draft(
    p_article_id uuid,
    p_headline text,
    p_body text,
    p_request_id uuid,
    p_expected_revision_number integer DEFAULT NULL
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
    v_current_revision_number integer;
    v_revision_number integer;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023'; END IF;
    IF NULLIF(btrim(p_headline), '') IS NULL OR NULLIF(btrim(p_body), '') IS NULL THEN
        RAISE EXCEPTION 'EDITORIAL_CONTENT_REQUIRED' USING ERRCODE = '22023';
    END IF;
    v_cliente_id := public.require_single_operational_cliente_id();
    PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);
    SELECT * INTO v_actor FROM public.profissionais WHERE id = v_user_id AND ativo IS TRUE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;

    SELECT * INTO v_article FROM ap.editorial_articles
    WHERE id = p_article_id AND cliente_id = v_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_article.news_backlog_id IS NOT NULL THEN
        PERFORM 1 FROM ap.news_backlog WHERE id = v_article.news_backlog_id FOR UPDATE;
    END IF;

    IF v_article.responsible_user_id <> v_user_id THEN
        BEGIN
            PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id);
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
        END;
    END IF;
    IF EXISTS (
        SELECT 1 FROM ap.editorial_article_events
        WHERE article_id = v_article.id AND action = 'draft_saved' AND request_id = p_request_id
    ) THEN RETURN v_article; END IF;
    IF v_article.status = 'content_final' THEN RAISE EXCEPTION 'CONTENT_ALREADY_FINAL' USING ERRCODE = '42501'; END IF;
    IF v_article.status NOT IN ('draft', 'editing', 'changes_requested') THEN
        RAISE EXCEPTION 'ARTICLE_NOT_EDITABLE' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(max(revision_number), 0) INTO v_current_revision_number
    FROM ap.editorial_article_revisions WHERE article_id = v_article.id;
    IF p_expected_revision_number IS NOT NULL AND p_expected_revision_number <> v_current_revision_number THEN
        RAISE EXCEPTION 'EDITORIAL_REVISION_CONFLICT' USING ERRCODE = '40001';
    END IF;
    v_revision_number := v_current_revision_number + 1;

    INSERT INTO ap.editorial_article_revisions (
        article_id, revision_number, revision_kind, headline, body,
        created_by_user_id, created_by_name_snapshot, request_id
    ) VALUES (
        v_article.id, v_revision_number, 'draft_checkpoint', btrim(p_headline), btrim(p_body),
        v_user_id, COALESCE(NULLIF(btrim(v_actor.nome), ''), 'Usuário'), p_request_id
    );
    UPDATE ap.editorial_articles SET status = 'editing', updated_at = now()
     WHERE id = v_article.id RETURNING * INTO v_article;
    INSERT INTO ap.editorial_article_events (
        article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
    ) VALUES (
        v_article.id, v_cliente_id, v_user_id, 'user', 'draft_saved',
        jsonb_build_object('revision_number', v_revision_number), p_request_id
    );
    RETURN v_article;
END;
$function$;

DROP FUNCTION IF EXISTS ap.finalize_editorial_article(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION ap.finalize_editorial_article(
    p_article_id uuid,
    p_headline text,
    p_body text,
    p_request_id uuid,
    p_expected_revision_number integer DEFAULT NULL
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
    v_current_revision_number integer;
    v_revision_number integer;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023'; END IF;
    IF NULLIF(btrim(p_headline), '') IS NULL OR NULLIF(btrim(p_body), '') IS NULL THEN
        RAISE EXCEPTION 'EDITORIAL_CONTENT_REQUIRED' USING ERRCODE = '22023';
    END IF;
    v_cliente_id := public.require_single_operational_cliente_id();
    PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);
    SELECT * INTO v_actor FROM public.profissionais WHERE id = v_user_id AND ativo IS TRUE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;

    SELECT * INTO v_article FROM ap.editorial_articles
    WHERE id = p_article_id AND cliente_id = v_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_article.news_backlog_id IS NOT NULL THEN
        PERFORM 1 FROM ap.news_backlog WHERE id = v_article.news_backlog_id FOR UPDATE;
    END IF;

    IF v_article.responsible_user_id <> v_user_id THEN
        BEGIN PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id);
        EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END;
    END IF;
    IF EXISTS (SELECT 1 FROM ap.editorial_article_events WHERE article_id = v_article.id AND action = 'content_finalized' AND request_id = p_request_id) THEN RETURN v_article; END IF;
    IF v_article.status = 'content_final' THEN RAISE EXCEPTION 'CONTENT_ALREADY_FINAL' USING ERRCODE = '42501'; END IF;
    IF v_article.status NOT IN ('draft', 'editing', 'changes_requested') THEN
        RAISE EXCEPTION 'ARTICLE_NOT_EDITABLE' USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(max(revision_number), 0) INTO v_current_revision_number
    FROM ap.editorial_article_revisions WHERE article_id = v_article.id;
    IF p_expected_revision_number IS NOT NULL AND p_expected_revision_number <> v_current_revision_number THEN
        RAISE EXCEPTION 'EDITORIAL_REVISION_CONFLICT' USING ERRCODE = '40001';
    END IF;
    v_revision_number := v_current_revision_number + 1;

    INSERT INTO ap.editorial_article_revisions (article_id, revision_number, revision_kind, headline, body, created_by_user_id, created_by_name_snapshot, request_id)
    VALUES (v_article.id, v_revision_number, 'content_final', btrim(p_headline), btrim(p_body), v_user_id, COALESCE(NULLIF(btrim(v_actor.nome), ''), 'Usuário'), p_request_id);
    UPDATE ap.editorial_articles
       SET status = 'content_final', author_user_id = v_user_id,
           author_name_snapshot = COALESCE(NULLIF(btrim(v_actor.nome), ''), 'Usuário'),
           finalized_by_user_id = v_user_id,
           finalized_by_name_snapshot = COALESCE(NULLIF(btrim(v_actor.nome), ''), 'Usuário'),
           first_finalized_at = COALESCE(first_finalized_at, now()), finalized_at = now(), updated_at = now()
     WHERE id = v_article.id RETURNING * INTO v_article;
    INSERT INTO ap.editorial_article_events (article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id)
    VALUES (v_article.id, v_cliente_id, v_user_id, 'user', 'content_finalized', jsonb_build_object('revision_number', v_revision_number), p_request_id);
    RETURN v_article;
END;
$function$;

CREATE OR REPLACE FUNCTION ap.reopen_editorial_article(p_article_id uuid, p_reason text, p_request_id uuid)
RETURNS ap.editorial_articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid(); v_cliente_id uuid; v_article ap.editorial_articles%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023'; END IF;
    v_cliente_id := public.require_single_operational_cliente_id(); PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);
    SELECT * INTO v_article FROM ap.editorial_articles WHERE id = p_article_id AND cliente_id = v_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_article.news_backlog_id IS NOT NULL THEN
        PERFORM 1 FROM ap.news_backlog WHERE id = v_article.news_backlog_id FOR UPDATE;
    END IF;
    IF v_article.responsible_user_id <> v_user_id THEN BEGIN PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id); EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END; END IF;
    IF EXISTS (SELECT 1 FROM ap.editorial_article_events WHERE article_id = v_article.id AND action = 'article_reopened' AND request_id = p_request_id) THEN RETURN v_article; END IF;
    IF v_article.status <> 'content_final' THEN RAISE EXCEPTION 'ARTICLE_NOT_EDITABLE' USING ERRCODE = '42501'; END IF;
    UPDATE ap.editorial_articles SET status = 'editing', updated_at = now() WHERE id = v_article.id RETURNING * INTO v_article;
    INSERT INTO ap.editorial_article_events (article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id)
    VALUES (v_article.id, v_cliente_id, v_user_id, 'user', 'article_reopened', jsonb_strip_nulls(jsonb_build_object('reason', NULLIF(btrim(p_reason), ''))), p_request_id);
    RETURN v_article;
END;
$function$;

CREATE OR REPLACE FUNCTION ap.abandon_editorial_article(p_article_id uuid, p_reason text, p_request_id uuid)
RETURNS ap.editorial_articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid(); v_cliente_id uuid; v_article ap.editorial_articles%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023'; END IF;
    v_cliente_id := public.require_single_operational_cliente_id(); PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);
    SELECT * INTO v_article FROM ap.editorial_articles WHERE id = p_article_id AND cliente_id = v_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_article.news_backlog_id IS NOT NULL THEN
        PERFORM 1 FROM ap.news_backlog WHERE id = v_article.news_backlog_id FOR UPDATE;
    END IF;
    IF v_article.responsible_user_id <> v_user_id THEN BEGIN PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id); EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END; END IF;
    IF EXISTS (SELECT 1 FROM ap.editorial_article_events WHERE article_id = v_article.id AND action = 'article_abandoned' AND request_id = p_request_id) THEN RETURN v_article; END IF;
    IF v_article.status = 'content_final' THEN RAISE EXCEPTION 'CONTENT_ALREADY_FINAL' USING ERRCODE = '42501'; END IF;
    IF v_article.status NOT IN ('draft', 'editing', 'changes_requested') THEN
        RAISE EXCEPTION 'ARTICLE_NOT_EDITABLE' USING ERRCODE = '42501';
    END IF;

    UPDATE ap.editorial_articles SET status = 'abandoned', abandoned_at = now(), updated_at = now() WHERE id = v_article.id RETURNING * INTO v_article;
    -- Direct-origin articles have no shared backlog item to release.
    IF v_article.news_backlog_id IS NOT NULL THEN
        UPDATE ap.news_backlog
           SET status = 'available', adopted_by_user_id = NULL, adopted_by_name_snapshot = NULL, adopted_at = NULL,
               released_by_user_id = v_user_id, released_at = now(), production_started_at = NULL, updated_at = now()
         WHERE id = v_article.news_backlog_id AND cliente_id = v_cliente_id;
        INSERT INTO ap.news_backlog_events (backlog_id, cliente_id, actor_user_id, action, metadata)
        VALUES (v_article.news_backlog_id, v_cliente_id, v_user_id, 'released', jsonb_strip_nulls(jsonb_build_object('editorial_article_id', v_article.id, 'reason', NULLIF(btrim(p_reason), ''))));
    END IF;
    INSERT INTO ap.editorial_article_events (article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id)
    VALUES (v_article.id, v_cliente_id, v_user_id, 'user', 'article_abandoned', jsonb_strip_nulls(jsonb_build_object('reason', NULLIF(btrim(p_reason), ''))), p_request_id);
    RETURN v_article;
END;
$function$;

-- Read model fix: this was an INNER JOIN, silently excluding every
-- direct-origin article (news_backlog_id IS NULL) from "Meu Trabalho".
-- Also collapses the zero-arg overload from migration 3 into this single
-- signature, so a zero-argument call can never become ambiguous.
DROP FUNCTION IF EXISTS ap.list_my_editorial_articles();

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
      AND article.responsible_user_id = v_user_id
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
