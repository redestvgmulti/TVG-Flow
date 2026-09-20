-- Canonical editorial AI draft vertical slice.
--
-- The AI layer is deliberately constrained to ap.editorial_articles. It
-- preserves an immutable source snapshot, creates append-only canonical
-- revisions, and never writes candidate_news/render/publication state.
BEGIN;

ALTER TABLE ap.editorial_feature_flags
    ADD COLUMN editorial_ai_draft_enabled boolean NOT NULL DEFAULT false;

CREATE FUNCTION ap.get_editorial_ai_draft_status()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_cliente_id uuid;
BEGIN
    v_cliente_id := public.require_single_operational_cliente_id();
    RETURN COALESCE((
        SELECT flags.editorial_ai_draft_enabled
        FROM ap.editorial_feature_flags AS flags
        WHERE flags.cliente_id = v_cliente_id
    ), false);
END;
$function$;

CREATE FUNCTION ap.set_editorial_ai_draft_enabled(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_cliente_id uuid;
    v_actor record;
    v_enabled boolean;
BEGIN
    IF p_enabled IS NULL THEN
        RAISE EXCEPTION 'EDITORIAL_AI_FLAG_VALUE_REQUIRED' USING ERRCODE = '22023';
    END IF;

    v_cliente_id := public.require_single_operational_cliente_id();
    SELECT * INTO v_actor FROM ap.require_editorial_admin_access(v_cliente_id);

    INSERT INTO ap.editorial_feature_flags AS flags (
        cliente_id,
        editorial_workflow_v1_enabled,
        editorial_ai_draft_enabled,
        updated_by_user_id,
        updated_at
    ) VALUES (
        v_cliente_id,
        false,
        p_enabled,
        v_actor.user_id,
        now()
    )
    ON CONFLICT (cliente_id) DO UPDATE
       SET editorial_ai_draft_enabled = EXCLUDED.editorial_ai_draft_enabled,
           updated_by_user_id = EXCLUDED.updated_by_user_id,
           updated_at = EXCLUDED.updated_at
    RETURNING flags.editorial_ai_draft_enabled INTO v_enabled;

    RETURN v_enabled;
END;
$function$;

REVOKE ALL ON FUNCTION ap.get_editorial_ai_draft_status() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.get_editorial_ai_draft_status() TO authenticated;
REVOKE ALL ON FUNCTION ap.set_editorial_ai_draft_enabled(boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.set_editorial_ai_draft_enabled(boolean) TO authenticated;

CREATE TABLE ap.editorial_article_sources (
    article_id uuid PRIMARY KEY,
    cliente_id uuid NOT NULL,
    source_type text NOT NULL
        CHECK (source_type IN ('text', 'link', 'image', 'news_backlog')),
    source_url text,
    source_title text,
    source_body text NOT NULL CHECK (length(btrim(source_body)) > 0),
    source_image_url text,
    source_backlog_id uuid,
    captured_by_user_id uuid NOT NULL
        REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT editorial_article_sources_article_tenant_fkey
        FOREIGN KEY (article_id, cliente_id)
        REFERENCES ap.editorial_articles(id, cliente_id) ON DELETE RESTRICT,
    CONSTRAINT editorial_article_sources_url_shape_check CHECK (
        (source_type = 'link' AND source_url ~ '^https?://')
        OR (source_type <> 'link' AND source_url IS NULL)
    ),
    CONSTRAINT editorial_article_sources_image_shape_check CHECK (
        source_image_url IS NULL OR source_image_url ~ '^https?://'
    )
);

CREATE TABLE ap.editorial_ai_draft_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    article_id uuid NOT NULL,
    cliente_id uuid NOT NULL,
    requested_by_user_id uuid NOT NULL
        REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    request_id uuid NOT NULL,
    base_revision_number integer NOT NULL CHECK (base_revision_number >= 0),
    status text NOT NULL CHECK (status IN ('processing', 'succeeded', 'failed')),
    provider text,
    model text,
    input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
    output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
    duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
    error_code text,
    result jsonb,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT editorial_ai_draft_runs_article_tenant_fkey
        FOREIGN KEY (article_id, cliente_id)
        REFERENCES ap.editorial_articles(id, cliente_id) ON DELETE RESTRICT,
    CONSTRAINT editorial_ai_draft_runs_article_request_key
        UNIQUE (article_id, request_id)
);

CREATE UNIQUE INDEX editorial_ai_draft_one_processing_per_article
    ON ap.editorial_ai_draft_runs(article_id)
    WHERE status = 'processing';
CREATE INDEX editorial_article_sources_captured_by_idx
    ON ap.editorial_article_sources(captured_by_user_id);
CREATE INDEX editorial_ai_draft_runs_requested_by_idx
    ON ap.editorial_ai_draft_runs(requested_by_user_id);

ALTER TABLE ap.editorial_article_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_article_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_ai_draft_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.editorial_ai_draft_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ap.editorial_article_sources FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE ap.editorial_ai_draft_runs FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER editorial_article_sources_append_only
    BEFORE UPDATE OR DELETE ON ap.editorial_article_sources
    FOR EACH ROW EXECUTE FUNCTION ap.reject_editorial_append_only_mutation();

ALTER TABLE ap.editorial_article_revisions
    DROP CONSTRAINT editorial_article_revisions_revision_kind_check;
ALTER TABLE ap.editorial_article_revisions
    ADD CONSTRAINT editorial_article_revisions_revision_kind_check
    CHECK (revision_kind IN ('draft_checkpoint', 'content_final', 'ai_draft'));

ALTER TABLE ap.editorial_article_revisions
    ADD COLUMN caption text,
    ADD COLUMN context_tag text,
    ADD COLUMN category text,
    ADD COLUMN location jsonb;

ALTER TABLE ap.editorial_article_revisions
    ADD CONSTRAINT editorial_article_revisions_location_shape_check CHECK (
        location IS NULL OR (
            jsonb_typeof(location) = 'object'
            AND location ? 'city'
            AND location ? 'region'
            AND location ? 'state'
            AND location - ARRAY['city', 'region', 'state']::text[] = '{}'::jsonb
            AND jsonb_typeof(location->'city') IN ('string', 'null')
            AND jsonb_typeof(location->'region') IN ('string', 'null')
            AND jsonb_typeof(location->'state') IN ('string', 'null')
        )
    );

ALTER TABLE ap.editorial_article_events
    DROP CONSTRAINT editorial_article_events_action_check;
ALTER TABLE ap.editorial_article_events
    ADD CONSTRAINT editorial_article_events_action_check CHECK (action IN (
        'article_created', 'draft_saved', 'content_finalized',
        'article_reopened', 'article_abandoned', 'article_reactivated',
        'changes_requested', 'approved_for_render', 'render_dispatched',
        'source_captured', 'ai_processing_started', 'ai_processing_failed',
        'ai_processing_retried', 'ai_draft_generated'
    ));

CREATE FUNCTION ap.capture_editorial_article_source(
    p_article_id uuid,
    p_source_type text,
    p_source_url text,
    p_source_title text,
    p_source_body text,
    p_source_image_url text,
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
    v_source ap.editorial_article_sources%ROWTYPE;
    v_title text := NULLIF(btrim(p_source_title), '');
    v_body text := NULLIF(btrim(p_source_body), '');
    v_url text := NULLIF(btrim(p_source_url), '');
    v_image text := NULLIF(btrim(p_source_image_url), '');
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_request_id IS NULL THEN
        RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF p_source_type NOT IN ('text', 'link', 'image') OR v_body IS NULL THEN
        RAISE EXCEPTION 'EDITORIAL_SOURCE_REQUIRED' USING ERRCODE = '22023';
    END IF;

    v_cliente_id := public.require_single_operational_cliente_id();
    PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);
    IF NOT COALESCE((
        SELECT flags.editorial_ai_draft_enabled
        FROM ap.editorial_feature_flags AS flags
        WHERE flags.cliente_id = v_cliente_id
    ), false) THEN
        RAISE EXCEPTION 'EDITORIAL_AI_DRAFT_DISABLED' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_article
    FROM ap.editorial_articles
    WHERE id = p_article_id AND cliente_id = v_cliente_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_article.responsible_user_id <> v_user_id THEN
        BEGIN
            PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id);
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
        END;
    END IF;
    IF v_article.status NOT IN ('draft', 'editing', 'changes_requested') THEN
        RAISE EXCEPTION 'ARTICLE_NOT_EDITABLE' USING ERRCODE = '42501';
    END IF;
    IF v_article.origin_type <> p_source_type THEN
        RAISE EXCEPTION 'EDITORIAL_SOURCE_TYPE_MISMATCH' USING ERRCODE = '22023';
    END IF;
    IF p_source_type = 'link' AND v_url IS DISTINCT FROM v_article.origin_reference THEN
        RAISE EXCEPTION 'EDITORIAL_SOURCE_URL_MISMATCH' USING ERRCODE = '22023';
    END IF;
    IF p_source_type <> 'link' AND v_url IS NOT NULL THEN
        RAISE EXCEPTION 'EDITORIAL_SOURCE_URL_NOT_ALLOWED' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_source
    FROM ap.editorial_article_sources
    WHERE ap.editorial_article_sources.article_id = v_article.id;
    IF FOUND THEN
        IF v_source.source_type = p_source_type
           AND v_source.source_url IS NOT DISTINCT FROM v_url
           AND v_source.source_title IS NOT DISTINCT FROM v_title
           AND v_source.source_body = v_body
           AND v_source.source_image_url IS NOT DISTINCT FROM v_image THEN
            RETURN v_source;
        END IF;
        RAISE EXCEPTION 'EDITORIAL_SOURCE_ALREADY_CAPTURED' USING ERRCODE = '23505';
    END IF;

    INSERT INTO ap.editorial_article_sources (
        article_id, cliente_id, source_type, source_url, source_title,
        source_body, source_image_url, source_backlog_id,
        captured_by_user_id, request_id
    ) VALUES (
        v_article.id, v_cliente_id, p_source_type, v_url, v_title,
        v_body, v_image, NULL, v_user_id, p_request_id
    ) RETURNING * INTO v_source;

    INSERT INTO ap.editorial_article_events (
        article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
    ) VALUES (
        v_article.id, v_cliente_id, v_user_id, 'user', 'source_captured',
        jsonb_strip_nulls(jsonb_build_object(
            'source_type', p_source_type,
            'has_url', v_url IS NOT NULL,
            'has_image', v_image IS NOT NULL
        )), p_request_id
    );

    RETURN v_source;
END;
$function$;

CREATE FUNCTION ap.claim_editorial_ai_draft(
    p_article_id uuid,
    p_request_id uuid
)
RETURNS TABLE(
    run_id uuid,
    article_id uuid,
    cliente_id uuid,
    request_id uuid,
    base_revision_number integer,
    source_type text,
    source_url text,
    source_title text,
    source_body text,
    source_image_url text,
    reused boolean,
    result jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
    v_cliente_id uuid;
    v_article ap.editorial_articles%ROWTYPE;
    v_source ap.editorial_article_sources%ROWTYPE;
    v_run ap.editorial_ai_draft_runs%ROWTYPE;
    v_revision integer;
    v_latest_kind text;
    v_retried boolean;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_request_id IS NULL THEN
        RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023';
    END IF;

    v_cliente_id := public.require_single_operational_cliente_id();
    PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);
    IF NOT COALESCE((
        SELECT flags.editorial_ai_draft_enabled
        FROM ap.editorial_feature_flags AS flags
        WHERE flags.cliente_id = v_cliente_id
    ), false) THEN
        RAISE EXCEPTION 'EDITORIAL_AI_DRAFT_DISABLED' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_article FROM ap.editorial_articles AS article
    WHERE article.id = p_article_id AND article.cliente_id = v_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_article.responsible_user_id <> v_user_id THEN
        BEGIN
            PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id);
        EXCEPTION WHEN insufficient_privilege THEN
            RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
        END;
    END IF;
    IF v_article.status NOT IN ('draft', 'editing', 'changes_requested') THEN
        RAISE EXCEPTION 'ARTICLE_NOT_EDITABLE' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_source FROM ap.editorial_article_sources
    WHERE ap.editorial_article_sources.article_id = v_article.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'EDITORIAL_SOURCE_NOT_CAPTURED' USING ERRCODE = 'P0002'; END IF;
    IF v_source.source_type NOT IN ('text', 'link', 'news_backlog') THEN
        RAISE EXCEPTION 'EDITORIAL_AI_SOURCE_UNSUPPORTED' USING ERRCODE = '22023';
    END IF;

    SELECT COALESCE(max(revision.revision_number), 0) INTO v_revision
    FROM ap.editorial_article_revisions AS revision WHERE revision.article_id = v_article.id;
    SELECT revision.revision_kind INTO v_latest_kind
    FROM ap.editorial_article_revisions AS revision
    WHERE revision.article_id = v_article.id
    ORDER BY revision.revision_number DESC LIMIT 1;

    SELECT * INTO v_run FROM ap.editorial_ai_draft_runs
    WHERE ap.editorial_ai_draft_runs.article_id = v_article.id
      AND ap.editorial_ai_draft_runs.request_id = p_request_id;
    IF FOUND THEN
        IF v_run.status = 'succeeded' THEN
            RETURN QUERY SELECT v_run.id, v_run.article_id, v_run.cliente_id, v_run.request_id,
                v_run.base_revision_number, v_source.source_type, v_source.source_url,
                v_source.source_title, v_source.source_body, v_source.source_image_url,
                true, v_run.result;
            RETURN;
        END IF;
        IF v_run.status = 'processing' THEN
            RAISE EXCEPTION 'EDITORIAL_AI_DRAFT_IN_PROGRESS' USING ERRCODE = '55000';
        END IF;
        RAISE EXCEPTION 'EDITORIAL_AI_REQUEST_ALREADY_FAILED' USING ERRCODE = '55000';
    END IF;

    IF v_revision > 0 THEN
        SELECT * INTO v_run
        FROM ap.editorial_ai_draft_runs
        WHERE ap.editorial_ai_draft_runs.article_id = v_article.id
          AND ap.editorial_ai_draft_runs.status = 'succeeded'
          AND ap.editorial_ai_draft_runs.base_revision_number + 1 = v_revision
        ORDER BY ap.editorial_ai_draft_runs.completed_at DESC
        LIMIT 1;
        IF FOUND AND v_latest_kind = 'ai_draft' THEN
            RETURN QUERY SELECT v_run.id, v_run.article_id, v_run.cliente_id, v_run.request_id,
                v_run.base_revision_number, v_source.source_type, v_source.source_url,
                v_source.source_title, v_source.source_body, v_source.source_image_url,
                true, v_run.result;
            RETURN;
        END IF;
        RAISE EXCEPTION 'EDITORIAL_AI_HUMAN_REVISION_PRESENT' USING ERRCODE = '55000';
    END IF;

    SELECT * INTO v_run FROM ap.editorial_ai_draft_runs
    WHERE ap.editorial_ai_draft_runs.article_id = v_article.id
      AND ap.editorial_ai_draft_runs.status = 'processing'
    FOR UPDATE;
    IF FOUND THEN
        IF v_run.started_at > now() - interval '2 minutes' THEN
            RAISE EXCEPTION 'EDITORIAL_AI_DRAFT_IN_PROGRESS' USING ERRCODE = '55000';
        END IF;
        UPDATE ap.editorial_ai_draft_runs
        SET status = 'failed', error_code = 'STALE_PROCESSING_LEASE', completed_at = now()
        WHERE id = v_run.id;
        INSERT INTO ap.editorial_article_events (
            article_id, cliente_id, actor_user_id, actor_kind, action, metadata
        ) VALUES (
            v_article.id, v_cliente_id, NULL, 'service', 'ai_processing_failed',
            jsonb_build_object('request_id', v_run.request_id, 'error_code', 'STALE_PROCESSING_LEASE')
        );
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM ap.editorial_ai_draft_runs
        WHERE ap.editorial_ai_draft_runs.article_id = v_article.id
          AND ap.editorial_ai_draft_runs.status = 'failed'
    ) INTO v_retried;
    INSERT INTO ap.editorial_ai_draft_runs (
        article_id, cliente_id, requested_by_user_id, request_id,
        base_revision_number, status
    ) VALUES (
        v_article.id, v_cliente_id, v_user_id, p_request_id,
        v_revision, 'processing'
    ) RETURNING * INTO v_run;

    IF v_retried THEN
        INSERT INTO ap.editorial_article_events (
            article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
        ) VALUES (
            v_article.id, v_cliente_id, v_user_id, 'user', 'ai_processing_retried',
            jsonb_build_object('base_revision_number', v_revision), p_request_id
        );
    END IF;
    INSERT INTO ap.editorial_article_events (
        article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
    ) VALUES (
        v_article.id, v_cliente_id, v_user_id, 'user', 'ai_processing_started',
        jsonb_build_object('base_revision_number', v_revision), p_request_id
    );

    RETURN QUERY SELECT v_run.id, v_run.article_id, v_run.cliente_id, v_run.request_id,
        v_run.base_revision_number, v_source.source_type, v_source.source_url,
        v_source.source_title, v_source.source_body, v_source.source_image_url,
        false, NULL::jsonb;
END;
$function$;

CREATE FUNCTION ap.complete_editorial_ai_draft(
    p_run_id uuid,
    p_draft jsonb,
    p_provider text,
    p_model text,
    p_input_tokens integer,
    p_output_tokens integer,
    p_duration_ms integer
)
RETURNS TABLE(applied boolean, error_code text, revision_number integer, result jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_run ap.editorial_ai_draft_runs%ROWTYPE;
    v_article ap.editorial_articles%ROWTYPE;
    v_actor public.profissionais%ROWTYPE;
    v_current_revision integer;
    v_next_revision integer;
    v_headline text := NULLIF(btrim(p_draft->>'headline'), '');
    v_body text := NULLIF(btrim(p_draft->>'body'), '');
    v_caption text := NULLIF(btrim(p_draft->>'caption'), '');
    v_context_tag text := NULLIF(btrim(p_draft->>'context_tag'), '');
    v_category text := NULLIF(btrim(p_draft->>'category'), '');
    v_location jsonb := p_draft->'location';
BEGIN
    PERFORM ap_private.require_p0_worker();
    IF p_run_id IS NULL OR p_draft IS NULL THEN
        RAISE EXCEPTION 'EDITORIAL_AI_RESULT_REQUIRED' USING ERRCODE = '22023';
    END IF;
    IF v_headline IS NULL OR v_body IS NULL OR v_caption IS NULL
       OR v_context_tag IS NULL OR v_category IS NULL
       OR jsonb_typeof(v_location) <> 'object'
       OR NOT (v_location ? 'city' AND v_location ? 'region' AND v_location ? 'state') THEN
        RAISE EXCEPTION 'EDITORIAL_AI_RESULT_INVALID' USING ERRCODE = '22023';
    END IF;

    -- Lock in the same article -> run order used by claim_editorial_ai_draft.
    -- The initial unlocked lookup is only used to resolve the article id; the
    -- authoritative run state is re-read under lock below.
    SELECT * INTO v_run FROM ap.editorial_ai_draft_runs WHERE id = p_run_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'EDITORIAL_AI_RUN_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

    SELECT * INTO v_article FROM ap.editorial_articles WHERE id = v_run.article_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO v_run FROM ap.editorial_ai_draft_runs WHERE id = p_run_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EDITORIAL_AI_RUN_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_run.status = 'succeeded' THEN
        RETURN QUERY SELECT true, NULL::text, v_run.base_revision_number + 1, v_run.result;
        RETURN;
    END IF;
    IF v_run.status <> 'processing' THEN
        RETURN QUERY SELECT false, COALESCE(v_run.error_code, 'EDITORIAL_AI_RUN_NOT_PROCESSING'), NULL::integer, NULL::jsonb;
        RETURN;
    END IF;

    SELECT COALESCE(max(r.revision_number), 0) INTO v_current_revision
    FROM ap.editorial_article_revisions r WHERE r.article_id = v_article.id;

    IF v_article.status NOT IN ('draft', 'editing', 'changes_requested')
       OR v_current_revision <> v_run.base_revision_number THEN
        UPDATE ap.editorial_ai_draft_runs
        SET status = 'failed', error_code = 'EDITORIAL_AI_REVISION_CONFLICT', completed_at = now(),
            provider = NULLIF(btrim(p_provider), ''), model = NULLIF(btrim(p_model), ''),
            duration_ms = GREATEST(COALESCE(p_duration_ms, 0), 0)
        WHERE id = v_run.id;
        INSERT INTO ap.editorial_article_events (
            article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
        ) VALUES (
            v_article.id, v_article.cliente_id, NULL, 'service', 'ai_processing_failed',
            jsonb_build_object(
                'request_id', v_run.request_id,
                'error_code', 'EDITORIAL_AI_REVISION_CONFLICT',
                'base_revision_number', v_run.base_revision_number,
                'current_revision_number', v_current_revision
            ), v_run.request_id
        );
        RETURN QUERY SELECT false, 'EDITORIAL_AI_REVISION_CONFLICT'::text, NULL::integer, NULL::jsonb;
        RETURN;
    END IF;

    SELECT * INTO v_actor FROM public.profissionais WHERE id = v_run.requested_by_user_id;
    v_next_revision := v_current_revision + 1;
    INSERT INTO ap.editorial_article_revisions (
        article_id, revision_number, revision_kind, headline, body,
        caption, context_tag, category, location,
        created_by_user_id, created_by_name_snapshot, request_id
    ) VALUES (
        v_article.id, v_next_revision, 'ai_draft', v_headline, v_body,
        v_caption, v_context_tag, v_category, v_location,
        v_run.requested_by_user_id,
        COALESCE(NULLIF(btrim(v_actor.nome), ''), 'Usuário'),
        v_run.request_id
    );

    UPDATE ap.editorial_articles
    SET status = 'editing', updated_at = now()
    WHERE id = v_article.id;

    UPDATE ap.editorial_ai_draft_runs
    SET status = 'succeeded',
        provider = NULLIF(btrim(p_provider), ''),
        model = NULLIF(btrim(p_model), ''),
        input_tokens = GREATEST(COALESCE(p_input_tokens, 0), 0),
        output_tokens = GREATEST(COALESCE(p_output_tokens, 0), 0),
        duration_ms = GREATEST(COALESCE(p_duration_ms, 0), 0),
        result = jsonb_build_object(
            'headline', v_headline,
            'body', v_body,
            'caption', v_caption,
            'context_tag', v_context_tag,
            'category', v_category,
            'location', v_location
        ),
        completed_at = now()
    WHERE id = v_run.id;

    INSERT INTO ap.editorial_article_events (
        article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
    ) VALUES (
        v_article.id, v_article.cliente_id, NULL, 'service', 'ai_draft_generated',
        jsonb_strip_nulls(jsonb_build_object(
            'provider', NULLIF(btrim(p_provider), ''),
            'model', NULLIF(btrim(p_model), ''),
            'duration_ms', GREATEST(COALESCE(p_duration_ms, 0), 0),
            'input_tokens', GREATEST(COALESCE(p_input_tokens, 0), 0),
            'output_tokens', GREATEST(COALESCE(p_output_tokens, 0), 0),
            'revision_number', v_next_revision,
            'request_id', v_run.request_id
        )), v_run.request_id
    );

    INSERT INTO ap.editorial_logs (cliente_id, input_tokens, output_tokens, model, prompt_snapshot)
    VALUES (
        v_article.cliente_id,
        GREATEST(COALESCE(p_input_tokens, 0), 0),
        GREATEST(COALESCE(p_output_tokens, 0), 0),
        NULLIF(btrim(p_model), ''),
        NULL
    );

    RETURN QUERY SELECT true, NULL::text, v_next_revision,
        jsonb_build_object(
            'headline', v_headline,
            'body', v_body,
            'caption', v_caption,
            'context_tag', v_context_tag,
            'category', v_category,
            'location', v_location
        );
END;
$function$;

CREATE FUNCTION ap.fail_editorial_ai_draft(
    p_run_id uuid,
    p_error_code text,
    p_provider text,
    p_model text,
    p_duration_ms integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_run ap.editorial_ai_draft_runs%ROWTYPE;
    v_error text := upper(regexp_replace(COALESCE(p_error_code, 'EDITORIAL_AI_FAILED'), '[^A-Z0-9_]', '_', 'g'));
BEGIN
    PERFORM ap_private.require_p0_worker();
    SELECT * INTO v_run FROM ap.editorial_ai_draft_runs WHERE id = p_run_id FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_run.status <> 'processing' THEN RETURN false; END IF;

    v_error := left(COALESCE(NULLIF(v_error, ''), 'EDITORIAL_AI_FAILED'), 80);
    UPDATE ap.editorial_ai_draft_runs
    SET status = 'failed', error_code = v_error,
        provider = NULLIF(btrim(p_provider), ''), model = NULLIF(btrim(p_model), ''),
        duration_ms = GREATEST(COALESCE(p_duration_ms, 0), 0), completed_at = now()
    WHERE id = v_run.id;

    INSERT INTO ap.editorial_article_events (
        article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id
    ) VALUES (
        v_run.article_id, v_run.cliente_id, NULL, 'service', 'ai_processing_failed',
        jsonb_strip_nulls(jsonb_build_object(
            'provider', NULLIF(btrim(p_provider), ''),
            'model', NULLIF(btrim(p_model), ''),
            'duration_ms', GREATEST(COALESCE(p_duration_ms, 0), 0),
            'error_code', v_error,
            'request_id', v_run.request_id
        )), v_run.request_id
    );
    RETURN true;
END;
$function$;

CREATE FUNCTION ap.save_editorial_article_draft_v2(
    p_article_id uuid,
    p_headline text,
    p_body text,
    p_caption text,
    p_context_tag text,
    p_category text,
    p_location jsonb,
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
    v_current_revision integer;
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
    IF v_article.responsible_user_id <> v_user_id THEN
        BEGIN PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id);
        EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END;
    END IF;
    IF EXISTS (SELECT 1 FROM ap.editorial_article_events WHERE article_id = v_article.id AND action = 'draft_saved' AND request_id = p_request_id) THEN RETURN v_article; END IF;
    IF v_article.status NOT IN ('draft', 'editing', 'changes_requested') THEN RAISE EXCEPTION 'ARTICLE_NOT_EDITABLE' USING ERRCODE = '42501'; END IF;
    SELECT COALESCE(max(revision_number), 0) INTO v_current_revision FROM ap.editorial_article_revisions WHERE article_id = v_article.id;
    IF p_expected_revision_number IS NOT NULL AND p_expected_revision_number <> v_current_revision THEN
        RAISE EXCEPTION 'EDITORIAL_REVISION_CONFLICT' USING ERRCODE = '40001';
    END IF;
    INSERT INTO ap.editorial_article_revisions (
        article_id, revision_number, revision_kind, headline, body,
        caption, context_tag, category, location,
        created_by_user_id, created_by_name_snapshot, request_id
    ) VALUES (
        v_article.id, v_current_revision + 1, 'draft_checkpoint', btrim(p_headline), btrim(p_body),
        NULLIF(btrim(p_caption), ''), NULLIF(btrim(p_context_tag), ''), NULLIF(btrim(p_category), ''), p_location,
        v_user_id, COALESCE(NULLIF(btrim(v_actor.nome), ''), 'Usuário'), p_request_id
    );
    UPDATE ap.editorial_articles SET status = 'editing', updated_at = now() WHERE id = v_article.id RETURNING * INTO v_article;
    INSERT INTO ap.editorial_article_events (article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id)
    VALUES (v_article.id, v_cliente_id, v_user_id, 'user', 'draft_saved', jsonb_build_object('revision_number', v_current_revision + 1), p_request_id);
    RETURN v_article;
END;
$function$;

CREATE FUNCTION ap.finalize_editorial_article_v2(
    p_article_id uuid,
    p_headline text,
    p_body text,
    p_caption text,
    p_context_tag text,
    p_category text,
    p_location jsonb,
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
    v_current_revision integer;
BEGIN
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    IF p_article_id IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'REQUEST_ID_REQUIRED' USING ERRCODE = '22023'; END IF;
    IF NULLIF(btrim(p_headline), '') IS NULL OR NULLIF(btrim(p_body), '') IS NULL THEN RAISE EXCEPTION 'EDITORIAL_CONTENT_REQUIRED' USING ERRCODE = '22023'; END IF;
    v_cliente_id := public.require_single_operational_cliente_id();
    PERFORM ap.assert_editorial_workflow_v1_enabled(v_cliente_id);
    SELECT * INTO v_actor FROM public.profissionais WHERE id = v_user_id AND ativo IS TRUE;
    IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
    SELECT * INTO v_article FROM ap.editorial_articles WHERE id = p_article_id AND cliente_id = v_cliente_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_article.responsible_user_id <> v_user_id THEN
        BEGIN PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id);
        EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END;
    END IF;
    IF EXISTS (SELECT 1 FROM ap.editorial_article_events WHERE article_id = v_article.id AND action = 'content_finalized' AND request_id = p_request_id) THEN RETURN v_article; END IF;
    IF v_article.status NOT IN ('draft', 'editing', 'changes_requested') THEN RAISE EXCEPTION 'ARTICLE_NOT_EDITABLE' USING ERRCODE = '42501'; END IF;
    SELECT COALESCE(max(revision_number), 0) INTO v_current_revision FROM ap.editorial_article_revisions WHERE article_id = v_article.id;
    IF p_expected_revision_number IS NOT NULL AND p_expected_revision_number <> v_current_revision THEN RAISE EXCEPTION 'EDITORIAL_REVISION_CONFLICT' USING ERRCODE = '40001'; END IF;
    INSERT INTO ap.editorial_article_revisions (
        article_id, revision_number, revision_kind, headline, body,
        caption, context_tag, category, location,
        created_by_user_id, created_by_name_snapshot, request_id
    ) VALUES (
        v_article.id, v_current_revision + 1, 'content_final', btrim(p_headline), btrim(p_body),
        NULLIF(btrim(p_caption), ''), NULLIF(btrim(p_context_tag), ''), NULLIF(btrim(p_category), ''), p_location,
        v_user_id, COALESCE(NULLIF(btrim(v_actor.nome), ''), 'Usuário'), p_request_id
    );
    UPDATE ap.editorial_articles
    SET status = 'content_final', author_user_id = v_user_id,
        author_name_snapshot = COALESCE(NULLIF(btrim(v_actor.nome), ''), 'Usuário'),
        finalized_by_user_id = v_user_id,
        finalized_by_name_snapshot = COALESCE(NULLIF(btrim(v_actor.nome), ''), 'Usuário'),
        first_finalized_at = COALESCE(first_finalized_at, now()), finalized_at = now(), updated_at = now()
    WHERE id = v_article.id RETURNING * INTO v_article;
    INSERT INTO ap.editorial_article_events (article_id, cliente_id, actor_user_id, actor_kind, action, metadata, request_id)
    VALUES (v_article.id, v_cliente_id, v_user_id, 'user', 'content_finalized', jsonb_build_object('revision_number', v_current_revision + 1), p_request_id);
    RETURN v_article;
END;
$function$;

DROP FUNCTION ap.get_editorial_article_for_edit(uuid);
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
    caption text,
    context_tag text,
    category text,
    location jsonb,
    revision_kind text,
    revision_number integer,
    candidate_news_id uuid,
    ai_source_captured boolean,
    original_source_title text,
    original_source_body text,
    original_source_url text,
    original_source_image_url text,
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
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
    v_cliente_id := public.require_single_operational_cliente_id();
    SELECT * INTO v_article FROM ap.editorial_articles
    WHERE ap.editorial_articles.id = p_article_id AND ap.editorial_articles.cliente_id = v_cliente_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ARTICLE_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    IF v_article.responsible_user_id <> v_user_id THEN
        BEGIN PERFORM 1 FROM ap.require_editorial_admin_access(v_cliente_id);
        EXCEPTION WHEN insufficient_privilege THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END;
    END IF;

    RETURN QUERY
    SELECT
        v_article.id, v_article.cliente_id, v_article.status,
        v_article.origin_type, v_article.origin_reference, v_article.production_input_type,
        v_article.content_type, v_article.visual_model, v_article.visual_title_id,
        v_article.region_id, v_article.city_id, v_article.manual_slots, v_article.source_image_url,
        v_article.responsible_user_id, v_article.responsible_name_snapshot, v_article.author_user_id,
        rev.headline, rev.body, rev.caption, rev.context_tag, rev.category, rev.location,
        rev.revision_kind, COALESCE(rev.revision_number, 0), v_article.candidate_news_id,
        EXISTS(SELECT 1 FROM ap.editorial_article_sources src WHERE src.article_id = v_article.id),
        src.source_title, src.source_body, src.source_url, src.source_image_url,
        v_article.updated_at
    FROM (SELECT 1) AS singleton
    LEFT JOIN LATERAL (
        SELECT r.* FROM ap.editorial_article_revisions r
        WHERE r.article_id = v_article.id
        ORDER BY r.revision_number DESC LIMIT 1
    ) rev ON true
    LEFT JOIN ap.editorial_article_sources src ON src.article_id = v_article.id;
END;
$function$;

REVOKE ALL ON FUNCTION ap.capture_editorial_article_source(uuid, text, text, text, text, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.capture_editorial_article_source(uuid, text, text, text, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION ap.claim_editorial_ai_draft(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.claim_editorial_ai_draft(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION ap.complete_editorial_ai_draft(uuid, jsonb, text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ap.complete_editorial_ai_draft(uuid, jsonb, text, text, integer, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION ap.fail_editorial_ai_draft(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ap.fail_editorial_ai_draft(uuid, text, text, text, integer) TO service_role;
REVOKE ALL ON FUNCTION ap.save_editorial_article_draft_v2(uuid, text, text, text, text, text, jsonb, uuid, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.save_editorial_article_draft_v2(uuid, text, text, text, text, text, jsonb, uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION ap.finalize_editorial_article_v2(uuid, text, text, text, text, text, jsonb, uuid, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.finalize_editorial_article_v2(uuid, text, text, text, text, text, jsonb, uuid, integer) TO authenticated;
REVOKE ALL ON FUNCTION ap.get_editorial_article_for_edit(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION ap.get_editorial_article_for_edit(uuid) TO authenticated;

COMMENT ON TABLE ap.editorial_article_sources IS
    'Immutable source snapshot for a canonical editorial article. It is distinct from every AI or human revision.';
COMMENT ON TABLE ap.editorial_ai_draft_runs IS
    'Tenant-scoped, server-owned AI draft processing leases and sanitized audit metadata.';
COMMENT ON FUNCTION ap.claim_editorial_ai_draft(uuid, uuid) IS
    'Authenticated tenant/permission gate and per-article processing lease. Never accepts cliente_id from the caller.';
COMMENT ON FUNCTION ap.complete_editorial_ai_draft(uuid, jsonb, text, text, integer, integer, integer) IS
    'Service-role completion with revision compare-and-swap; a later human revision makes the AI result non-applicable.';

COMMIT;
