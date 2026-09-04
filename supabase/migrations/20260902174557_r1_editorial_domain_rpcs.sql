-- R1 / Migration 3: RPC-only transactional editorial workflow.
-- The client id is always derived from the authenticated principal.  This
-- migration intentionally does not create or mutate legacy candidates.
BEGIN;

CREATE FUNCTION ap.assert_editorial_workflow_v1_enabled(p_cliente_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM ap.editorial_feature_flags AS flag
        WHERE flag.cliente_id = p_cliente_id
          AND flag.editorial_workflow_v1_enabled IS TRUE
    ) THEN
        RAISE EXCEPTION 'EDITORIAL_WORKFLOW_DISABLED' USING ERRCODE = '42501';
    END IF;
END;
$function$;

CREATE FUNCTION ap.start_editorial_article_from_backlog(
    p_backlog_id uuid,
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
    v_actor public.profissionais%ROWTYPE;
    v_backlog ap.news_backlog%ROWTYPE;
    v_article ap.editorial_articles%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
    END IF;
    IF p_backlog_id IS NULL OR p_request_id IS NULL THEN
        RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023';
    END IF;

    v_cliente_id := public.require_single_operational_cliente_id();
    PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);

    SELECT * INTO v_actor
    FROM public.profissionais
    WHERE id = v_user_id AND ativo IS TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- Lock order is backlog, then article for every mutation in this migration.
    SELECT * INTO v_backlog
    FROM ap.news_backlog AS backlog
    WHERE backlog.id = p_backlog_id
      AND backlog.cliente_id = v_cliente_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BACKLOG_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    SELECT * INTO v_article
    FROM ap.editorial_articles AS article
    WHERE article.news_backlog_id = v_backlog.id
    FOR UPDATE;

    IF FOUND AND v_article.status <> 'abandoned' THEN
        IF v_article.responsible_user_id <> v_user_id THEN
            RAISE EXCEPTION 'BACKLOG_NOT_OWNED' USING ERRCODE = '42501';
        END IF;
        RETURN v_article;
    END IF;

    IF v_backlog.candidate_news_id IS NOT NULL THEN
        RAISE EXCEPTION 'BACKLOG_LEGACY_CANDIDATE_LINKED' USING ERRCODE = '42501';
    END IF;

    IF FOUND THEN
        -- An abandoned article is deliberately reused after a fresh adoption;
        -- no second article may be created for the same backlog item.
        IF v_backlog.status <> 'adopted' THEN
            RAISE EXCEPTION 'BACKLOG_NOT_ADOPTED' USING ERRCODE = '42501';
        END IF;
        IF v_backlog.adopted_by_user_id <> v_user_id THEN
            RAISE EXCEPTION 'BACKLOG_NOT_OWNED' USING ERRCODE = '42501';
        END IF;

        UPDATE ap.editorial_articles
           SET status = 'draft',
               responsible_user_id = v_user_id,
               responsible_name_snapshot = COALESCE(NULLIF(btrim(v_actor.nome), ''), 'Usuário'),
               updated_at = now()
         WHERE id = v_article.id
         RETURNING * INTO v_article;

        INSERT INTO ap.editorial_article_events (
            article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
        ) VALUES (
            v_article.id, v_cliente_id, v_user_id, 'user', 'article_reactivated',
            jsonb_build_object('backlog_id', v_backlog.id), p_request_id
        ) ON CONFLICT (article_id, action, request_id) WHERE request_id IS NOT NULL DO NOTHING;
    ELSE
        IF v_backlog.status <> 'adopted' THEN
            RAISE EXCEPTION 'BACKLOG_NOT_ADOPTED' USING ERRCODE = '42501';
        END IF;
        IF v_backlog.adopted_by_user_id <> v_user_id THEN
            RAISE EXCEPTION 'BACKLOG_NOT_OWNED' USING ERRCODE = '42501';
        END IF;

        INSERT INTO ap.editorial_articles (
            cliente_id, news_backlog_id, responsible_user_id, responsible_name_snapshot
        ) VALUES (
            v_cliente_id, v_backlog.id, v_user_id,
            COALESCE(NULLIF(btrim(v_actor.nome), ''), 'Usuário')
        ) RETURNING * INTO v_article;

        INSERT INTO ap.editorial_article_events (
            article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
        ) VALUES (
            v_article.id, v_cliente_id, v_user_id, 'user', 'article_created',
            jsonb_build_object('backlog_id', v_backlog.id), p_request_id
        ) ON CONFLICT (article_id, action, request_id) WHERE request_id IS NOT NULL DO NOTHING;
    END IF;

    -- `in_production` keeps the adopted item out of the available Banco de
    -- pautas and out of other workers' active queues.
    UPDATE ap.news_backlog
       SET status = 'in_production',
           production_started_at = COALESCE(production_started_at, now()),
           updated_at = now()
     WHERE id = v_backlog.id
       AND cliente_id = v_cliente_id;

    INSERT INTO ap.news_backlog_events (
        backlog_id, cliente_id, actor_user_id, action, metadata
    ) VALUES (
        v_backlog.id, v_cliente_id, v_user_id, 'production_started',
        jsonb_build_object('editorial_article_id', v_article.id, 'request_id', p_request_id)
    ) ON CONFLICT DO NOTHING;

    RETURN v_article;
END;
$function$;

CREATE FUNCTION ap.save_editorial_article_draft(
    p_article_id uuid,
    p_headline text,
    p_body text,
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
    v_actor public.profissionais%ROWTYPE;
    v_backlog ap.news_backlog%ROWTYPE;
    v_article ap.editorial_articles%ROWTYPE;
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

    SELECT backlog.* INTO v_backlog
    FROM ap.editorial_articles AS article
    JOIN ap.news_backlog AS backlog ON backlog.id = article.news_backlog_id
    WHERE article.id = p_article_id AND article.cliente_id = v_cliente_id
    FOR UPDATE OF backlog;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO v_article FROM ap.editorial_articles WHERE id = p_article_id FOR UPDATE;

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
    IF v_article.status NOT IN ('draft', 'editing') THEN RAISE EXCEPTION 'ARTICLE_NOT_EDITABLE' USING ERRCODE = '42501'; END IF;

    SELECT COALESCE(max(revision_number), 0) + 1 INTO v_revision_number
    FROM ap.editorial_article_revisions WHERE article_id = v_article.id;
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

CREATE FUNCTION ap.finalize_editorial_article(
    p_article_id uuid,
    p_headline text,
    p_body text,
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
    v_actor public.profissionais%ROWTYPE;
    v_backlog ap.news_backlog%ROWTYPE;
    v_article ap.editorial_articles%ROWTYPE;
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
    SELECT backlog.* INTO v_backlog
    FROM ap.editorial_articles AS article JOIN ap.news_backlog AS backlog ON backlog.id = article.news_backlog_id
    WHERE article.id = p_article_id AND article.cliente_id = v_cliente_id FOR UPDATE OF backlog;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO v_article FROM ap.editorial_articles WHERE id = p_article_id FOR UPDATE;
    IF v_article.responsible_user_id <> v_user_id THEN
        BEGIN PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id);
        EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END;
    END IF;
    IF EXISTS (SELECT 1 FROM ap.editorial_article_events WHERE article_id = v_article.id AND action = 'content_finalized' AND request_id = p_request_id) THEN RETURN v_article; END IF;
    IF v_article.status = 'content_final' THEN RAISE EXCEPTION 'CONTENT_ALREADY_FINAL' USING ERRCODE = '42501'; END IF;
    IF v_article.status NOT IN ('draft', 'editing') THEN RAISE EXCEPTION 'ARTICLE_NOT_EDITABLE' USING ERRCODE = '42501'; END IF;

    SELECT COALESCE(max(revision_number), 0) + 1 INTO v_revision_number FROM ap.editorial_article_revisions WHERE article_id = v_article.id;
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

CREATE FUNCTION ap.reopen_editorial_article(p_article_id uuid, p_reason text, p_request_id uuid)
RETURNS ap.editorial_articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid(); v_cliente_id uuid; v_backlog ap.news_backlog%ROWTYPE; v_article ap.editorial_articles%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023'; END IF;
    v_cliente_id := public.require_single_operational_cliente_id(); PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);
    SELECT backlog.* INTO v_backlog FROM ap.editorial_articles article JOIN ap.news_backlog backlog ON backlog.id = article.news_backlog_id WHERE article.id = p_article_id AND article.cliente_id = v_cliente_id FOR UPDATE OF backlog;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO v_article FROM ap.editorial_articles WHERE id = p_article_id FOR UPDATE;
    IF v_article.responsible_user_id <> v_user_id THEN BEGIN PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id); EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END; END IF;
    IF EXISTS (SELECT 1 FROM ap.editorial_article_events WHERE article_id = v_article.id AND action = 'article_reopened' AND request_id = p_request_id) THEN RETURN v_article; END IF;
    IF v_article.status <> 'content_final' THEN RAISE EXCEPTION 'ARTICLE_NOT_EDITABLE' USING ERRCODE = '42501'; END IF;
    UPDATE ap.editorial_articles SET status = 'editing', updated_at = now() WHERE id = v_article.id RETURNING * INTO v_article;
    INSERT INTO ap.editorial_article_events (article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id)
    VALUES (v_article.id, v_cliente_id, v_user_id, 'user', 'article_reopened', jsonb_strip_nulls(jsonb_build_object('reason', NULLIF(btrim(p_reason), ''))), p_request_id);
    RETURN v_article;
END;
$function$;

CREATE FUNCTION ap.abandon_editorial_article(p_article_id uuid, p_reason text, p_request_id uuid)
RETURNS ap.editorial_articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid(); v_cliente_id uuid; v_backlog ap.news_backlog%ROWTYPE; v_article ap.editorial_articles%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023'; END IF;
    v_cliente_id := public.require_single_operational_cliente_id(); PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);
    SELECT backlog.* INTO v_backlog FROM ap.editorial_articles article JOIN ap.news_backlog backlog ON backlog.id = article.news_backlog_id WHERE article.id = p_article_id AND article.cliente_id = v_cliente_id FOR UPDATE OF backlog;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO v_article FROM ap.editorial_articles WHERE id = p_article_id FOR UPDATE;
    IF v_article.responsible_user_id <> v_user_id THEN BEGIN PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id); EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END; END IF;
    IF EXISTS (SELECT 1 FROM ap.editorial_article_events WHERE article_id = v_article.id AND action = 'article_abandoned' AND request_id = p_request_id) THEN RETURN v_article; END IF;
    IF v_article.status = 'content_final' THEN RAISE EXCEPTION 'CONTENT_ALREADY_FINAL' USING ERRCODE = '42501'; END IF;
    IF v_article.status NOT IN ('draft', 'editing') THEN RAISE EXCEPTION 'ARTICLE_NOT_EDITABLE' USING ERRCODE = '42501'; END IF;

    UPDATE ap.editorial_articles SET status = 'abandoned', abandoned_at = now(), updated_at = now() WHERE id = v_article.id RETURNING * INTO v_article;
    -- Explicit abandonment is the only R3 path that returns this item to the shared bank.
    UPDATE ap.news_backlog
       SET status = 'available', adopted_by_user_id = NULL, adopted_by_name_snapshot = NULL, adopted_at = NULL,
           released_by_user_id = v_user_id, released_at = now(), production_started_at = NULL, updated_at = now()
     WHERE id = v_backlog.id AND cliente_id = v_cliente_id;
    INSERT INTO ap.editorial_article_events (article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id)
    VALUES (v_article.id, v_cliente_id, v_user_id, 'user', 'article_abandoned', jsonb_strip_nulls(jsonb_build_object('reason', NULLIF(btrim(p_reason), ''))), p_request_id);
    INSERT INTO ap.news_backlog_events (backlog_id, cliente_id, actor_user_id, action, metadata)
    VALUES (v_backlog.id, v_cliente_id, v_user_id, 'released', jsonb_strip_nulls(jsonb_build_object('editorial_article_id', v_article.id, 'reason', NULLIF(btrim(p_reason), ''))));
    RETURN v_article;
END;
$function$;

CREATE FUNCTION ap.get_editorial_article(p_article_id uuid)
RETURNS ap.editorial_articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_user_id uuid := auth.uid(); v_cliente_id uuid; v_article ap.editorial_articles%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    v_cliente_id := public.require_single_operational_cliente_id();
    SELECT * INTO v_article FROM ap.editorial_articles WHERE id = p_article_id AND cliente_id = v_cliente_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_article.responsible_user_id <> v_user_id THEN BEGIN PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id); EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END; END IF;
    RETURN v_article;
END;
$function$;

CREATE FUNCTION ap.list_my_editorial_articles()
RETURNS SETOF ap.editorial_articles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_user_id uuid := auth.uid(); v_cliente_id uuid; v_role text;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    v_cliente_id := public.require_single_operational_cliente_id();
    SELECT role INTO v_role FROM public.profissionais WHERE id = v_user_id AND ativo IS TRUE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
    IF v_role = 'admin' THEN
        RETURN QUERY SELECT * FROM ap.editorial_articles WHERE cliente_id = v_cliente_id ORDER BY updated_at DESC;
    ELSE
        RETURN QUERY SELECT * FROM ap.editorial_articles WHERE cliente_id = v_cliente_id AND responsible_user_id = v_user_id ORDER BY updated_at DESC;
    END IF;
END;
$function$;

CREATE FUNCTION ap.list_editorial_article_events(p_article_id uuid)
RETURNS SETOF ap.editorial_article_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_article ap.editorial_articles%ROWTYPE;
BEGIN
    SELECT * INTO v_article FROM ap.get_editorial_article(p_article_id);
    RETURN QUERY SELECT * FROM ap.editorial_article_events WHERE article_id = v_article.id ORDER BY created_at ASC, id ASC;
END;
$function$;

REVOKE ALL ON FUNCTION ap.assert_editorial_workflow_v1_enabled(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ap.start_editorial_article_from_backlog(uuid, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION ap.save_editorial_article_draft(uuid, text, text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION ap.finalize_editorial_article(uuid, text, text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION ap.reopen_editorial_article(uuid, text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION ap.abandon_editorial_article(uuid, text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION ap.get_editorial_article(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION ap.list_my_editorial_articles() FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION ap.list_editorial_article_events(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.start_editorial_article_from_backlog(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.save_editorial_article_draft(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.finalize_editorial_article(uuid, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.reopen_editorial_article(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.abandon_editorial_article(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.get_editorial_article(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.list_my_editorial_articles() TO authenticated;
GRANT EXECUTE ON FUNCTION ap.list_editorial_article_events(uuid) TO authenticated;

COMMIT;
