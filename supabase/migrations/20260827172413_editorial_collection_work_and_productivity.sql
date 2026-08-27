-- Editorial collection, curation, ownership and productivity V2.
-- Scraped sources are staged here and never enter candidate_news automatically.

BEGIN;

-- ---------------------------------------------------------------------------
-- Source capabilities and operational health
-- ---------------------------------------------------------------------------

ALTER TABLE ap.sources DROP CONSTRAINT IF EXISTS sources_tipo_check;
ALTER TABLE ap.sources
    ADD CONSTRAINT sources_tipo_check
    CHECK (tipo IN ('auto', 'website', 'rss', 'atom', 'google_news_rss', 'sitemap'));

ALTER TABLE ap.sources
    ADD COLUMN IF NOT EXISTS detected_type text,
    ADD COLUMN IF NOT EXISTS last_checked_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_error_code text,
    ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_discovered_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_collected_count integer NOT NULL DEFAULT 0;

ALTER TABLE ap.sources DROP CONSTRAINT IF EXISTS sources_detected_type_check;
ALTER TABLE ap.sources
    ADD CONSTRAINT sources_detected_type_check
    CHECK (detected_type IS NULL OR detected_type IN ('website', 'rss', 'atom', 'google_news_rss', 'sitemap'));

-- ---------------------------------------------------------------------------
-- Admin-only collection inbox
-- ---------------------------------------------------------------------------

CREATE TABLE ap.collected_news (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    source_id uuid NOT NULL REFERENCES ap.sources(id) ON DELETE CASCADE,
    url_original text NOT NULL,
    canonical_url text NOT NULL,
    normalized_url text NOT NULL,
    title text NOT NULL,
    excerpt text,
    content text,
    image_url text,
    published_at timestamptz,
    collected_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    content_hash text,
    parser_version text NOT NULL DEFAULT 'collector-v2',
    status text NOT NULL DEFAULT 'pending_review',
    approved_by_user_id uuid REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    approved_by_name_snapshot text,
    approved_at timestamptz,
    discarded_by_user_id uuid REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    discarded_by_name_snapshot text,
    discarded_at timestamptz,
    discard_reason text,
    news_backlog_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT collected_news_url_check CHECK (url_original ~* '^https?://' AND canonical_url ~* '^https?://'),
    CONSTRAINT collected_news_status_check CHECK (status IN ('pending_review', 'approved', 'discarded', 'duplicate', 'failed')),
    CONSTRAINT collected_news_review_consistency_check CHECK (
        (status = 'approved' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
        OR (status = 'discarded' AND discarded_by_user_id IS NOT NULL AND discarded_at IS NOT NULL)
        OR status IN ('pending_review', 'duplicate', 'failed')
    )
);

CREATE UNIQUE INDEX uq_collected_news_cliente_normalized
    ON ap.collected_news (cliente_id, normalized_url);
CREATE INDEX idx_collected_news_review_queue
    ON ap.collected_news (cliente_id, status, collected_at DESC);
CREATE INDEX idx_collected_news_source_seen
    ON ap.collected_news (source_id, last_seen_at DESC);
CREATE INDEX idx_collected_news_approved_by
    ON ap.collected_news (approved_by_user_id)
    WHERE approved_by_user_id IS NOT NULL;
CREATE INDEX idx_collected_news_discarded_by
    ON ap.collected_news (discarded_by_user_id)
    WHERE discarded_by_user_id IS NOT NULL;

CREATE TABLE ap.collected_news_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    collected_news_id uuid NOT NULL REFERENCES ap.collected_news(id) ON DELETE CASCADE,
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    actor_user_id uuid REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    action text NOT NULL CHECK (action IN ('collected', 'refreshed', 'approved', 'discarded', 'duplicate')),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_collected_news_events_item_created
    ON ap.collected_news_events (collected_news_id, created_at DESC);
CREATE INDEX idx_collected_news_events_cliente
    ON ap.collected_news_events (cliente_id);
CREATE INDEX idx_collected_news_events_actor
    ON ap.collected_news_events (actor_user_id)
    WHERE actor_user_id IS NOT NULL;

CREATE TABLE ap.source_ingestion_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id uuid NOT NULL REFERENCES ap.sources(id) ON DELETE CASCADE,
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    worker_id uuid,
    detected_type text,
    status text NOT NULL CHECK (status IN ('success', 'completed_with_errors', 'error')),
    discovered_count integer NOT NULL DEFAULT 0,
    collected_count integer NOT NULL DEFAULT 0,
    skipped_old_count integer NOT NULL DEFAULT 0,
    error_count integer NOT NULL DEFAULT 0,
    error_code text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_source_ingestion_runs_source_finished
    ON ap.source_ingestion_runs (source_id, finished_at DESC);
CREATE INDEX idx_source_ingestion_runs_cliente
    ON ap.source_ingestion_runs (cliente_id);

CREATE OR REPLACE FUNCTION ap.set_collected_news_derived_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
    NEW.url_original := btrim(NEW.url_original);
    NEW.canonical_url := btrim(COALESCE(NULLIF(NEW.canonical_url, ''), NEW.url_original));
    NEW.normalized_url := ap.normalize_news_backlog_url(NEW.canonical_url);
    NEW.title := btrim(NEW.title);
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION ap.set_collected_news_derived_fields() FROM PUBLIC;

CREATE TRIGGER trg_collected_news_derived_fields
BEFORE INSERT OR UPDATE OF url_original, canonical_url, title ON ap.collected_news
FOR EACH ROW EXECUTE FUNCTION ap.set_collected_news_derived_fields();

ALTER TABLE ap.collected_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.collected_news_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.source_ingestion_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE ap.collected_news FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE ap.collected_news_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE ap.source_ingestion_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE ap.collected_news TO service_role;
GRANT ALL ON TABLE ap.collected_news_events TO service_role;
GRANT ALL ON TABLE ap.source_ingestion_runs TO service_role;

CREATE OR REPLACE FUNCTION ap.require_editorial_admin_access(p_cliente_id uuid)
RETURNS TABLE (user_id uuid, role text, display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
    END IF;

    RETURN QUERY
    SELECT professional.id, professional.role, professional.nome
    FROM public.profissionais AS professional
    WHERE professional.id = v_user_id
      AND professional.ativo IS TRUE
      AND professional.role = 'admin'
      AND EXISTS (
          SELECT 1
          FROM ap.get_operational_cliente_ids() AS allowed(cliente_id)
          WHERE allowed.cliente_id = p_cliente_id
      );

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EDITORIAL_ADMIN_REQUIRED' USING ERRCODE = '42501';
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION ap.ingest_collected_news(
    p_cliente_id uuid,
    p_source_id uuid,
    p_url_original text,
    p_canonical_url text,
    p_title text,
    p_excerpt text DEFAULT NULL,
    p_content text DEFAULT NULL,
    p_image_url text DEFAULT NULL,
    p_published_at timestamptz DEFAULT NULL,
    p_content_hash text DEFAULT NULL,
    p_parser_version text DEFAULT 'collector-v2',
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_normalized text;
    v_result ap.collected_news%ROWTYPE;
    v_created boolean := false;
BEGIN
    IF session_user <> 'postgres'
       AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM ap.sources source
        WHERE source.id = p_source_id
          AND source.cliente_id = p_cliente_id
          AND source.ativo IS TRUE
    ) THEN
        RAISE EXCEPTION 'SOURCE_SCOPE_INVALID' USING ERRCODE = '42501';
    END IF;

    IF length(btrim(COALESCE(p_title, ''))) < 3 THEN
        RAISE EXCEPTION 'COLLECTED_TITLE_INVALID' USING ERRCODE = '22023';
    END IF;

    v_normalized := ap.normalize_news_backlog_url(
        COALESCE(NULLIF(btrim(p_canonical_url), ''), btrim(p_url_original))
    );

    INSERT INTO ap.collected_news (
        cliente_id, source_id, url_original, canonical_url, normalized_url,
        title, excerpt, content, image_url, published_at, content_hash,
        parser_version, metadata
    ) VALUES (
        p_cliente_id, p_source_id, btrim(p_url_original),
        COALESCE(NULLIF(btrim(p_canonical_url), ''), btrim(p_url_original)),
        v_normalized, btrim(p_title), NULLIF(btrim(p_excerpt), ''),
        NULLIF(btrim(p_content), ''), NULLIF(btrim(p_image_url), ''),
        p_published_at, NULLIF(btrim(p_content_hash), ''),
        COALESCE(NULLIF(btrim(p_parser_version), ''), 'collector-v2'),
        COALESCE(p_metadata, '{}'::jsonb)
    )
    ON CONFLICT (cliente_id, normalized_url) DO NOTHING
    RETURNING * INTO v_result;

    IF FOUND THEN
        v_created := true;
        INSERT INTO ap.collected_news_events (
            collected_news_id, cliente_id, actor_user_id, action,
            metadata
        ) VALUES (
            v_result.id, p_cliente_id, NULL, 'collected',
            jsonb_build_object('source_id', p_source_id)
        );
    ELSE
        UPDATE ap.collected_news AS collected
           SET last_seen_at = now(),
               title = CASE WHEN collected.status = 'pending_review' THEN btrim(p_title) ELSE collected.title END,
               excerpt = CASE WHEN collected.status = 'pending_review' THEN COALESCE(NULLIF(btrim(p_excerpt), ''), collected.excerpt) ELSE collected.excerpt END,
               content = CASE WHEN collected.status = 'pending_review' THEN COALESCE(NULLIF(btrim(p_content), ''), collected.content) ELSE collected.content END,
               image_url = CASE WHEN collected.status = 'pending_review' THEN COALESCE(NULLIF(btrim(p_image_url), ''), collected.image_url) ELSE collected.image_url END,
               published_at = COALESCE(collected.published_at, p_published_at),
               content_hash = COALESCE(NULLIF(btrim(p_content_hash), ''), collected.content_hash),
               parser_version = COALESCE(NULLIF(btrim(p_parser_version), ''), collected.parser_version),
               metadata = collected.metadata || COALESCE(p_metadata, '{}'::jsonb)
         WHERE collected.cliente_id = p_cliente_id
           AND collected.normalized_url = v_normalized
         RETURNING * INTO v_result;

        INSERT INTO ap.collected_news_events (
            collected_news_id, cliente_id, actor_user_id, action,
            metadata
        ) VALUES (
            v_result.id, p_cliente_id, NULL, 'refreshed',
            jsonb_build_object('source_id', p_source_id)
        );
    END IF;

    RETURN jsonb_build_object('created', v_created, 'item', to_jsonb(v_result));
END;
$function$;

CREATE OR REPLACE FUNCTION ap.list_collected_news(
    p_cliente_id uuid,
    p_status text DEFAULT NULL,
    p_limit integer DEFAULT 200,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid,
    source_id uuid,
    source_name text,
    url_original text,
    canonical_url text,
    title text,
    excerpt text,
    image_url text,
    published_at timestamptz,
    collected_at timestamptz,
    last_seen_at timestamptz,
    status text,
    approved_by_name_snapshot text,
    approved_at timestamptz,
    discarded_by_name_snapshot text,
    discarded_at timestamptz,
    discard_reason text,
    news_backlog_id uuid,
    metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    PERFORM 1 FROM ap.require_editorial_admin_access(p_cliente_id);
    IF p_status IS NOT NULL AND p_status NOT IN ('pending_review', 'approved', 'discarded', 'duplicate', 'failed') THEN
        RAISE EXCEPTION 'COLLECTED_STATUS_INVALID' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT collected.id, collected.source_id, source.nome, collected.url_original,
           collected.canonical_url, collected.title, collected.excerpt,
           collected.image_url, collected.published_at, collected.collected_at,
           collected.last_seen_at, collected.status,
           collected.approved_by_name_snapshot, collected.approved_at,
           collected.discarded_by_name_snapshot, collected.discarded_at,
           collected.discard_reason, collected.news_backlog_id, collected.metadata
    FROM ap.collected_news AS collected
    JOIN ap.sources AS source ON source.id = collected.source_id
    WHERE collected.cliente_id = p_cliente_id
      AND (p_status IS NULL OR collected.status = p_status)
    ORDER BY
        CASE collected.status WHEN 'pending_review' THEN 0 ELSE 1 END,
        collected.collected_at DESC,
        collected.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$function$;

CREATE OR REPLACE FUNCTION ap.get_collected_news_counts(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_counts jsonb;
BEGIN
    PERFORM 1 FROM ap.require_editorial_admin_access(p_cliente_id);
    SELECT jsonb_build_object(
        'pending_review', count(*) FILTER (WHERE status = 'pending_review'),
        'approved', count(*) FILTER (WHERE status = 'approved'),
        'discarded', count(*) FILTER (WHERE status = 'discarded'),
        'duplicate', count(*) FILTER (WHERE status = 'duplicate'),
        'failed', count(*) FILTER (WHERE status = 'failed'),
        'total', count(*)
    ) INTO v_counts
    FROM ap.collected_news
    WHERE cliente_id = p_cliente_id;
    RETURN v_counts;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Curated approval into the shared backlog
-- ---------------------------------------------------------------------------

ALTER TABLE ap.news_backlog
    ADD COLUMN IF NOT EXISTS collected_news_id uuid REFERENCES ap.collected_news(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS production_completed_at timestamptz,
    ADD COLUMN IF NOT EXISTS completed_by_user_id uuid REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS completed_by_name_snapshot text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_news_backlog_collected_news
    ON ap.news_backlog (collected_news_id)
    WHERE collected_news_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_news_backlog_completed_by
    ON ap.news_backlog (completed_by_user_id, production_completed_at DESC)
    WHERE completed_by_user_id IS NOT NULL;

ALTER TABLE ap.collected_news
    ADD CONSTRAINT collected_news_backlog_fkey
    FOREIGN KEY (news_backlog_id) REFERENCES ap.news_backlog(id) ON DELETE SET NULL;

ALTER TABLE ap.news_backlog DROP CONSTRAINT IF EXISTS news_backlog_origem_check;
ALTER TABLE ap.news_backlog
    ADD CONSTRAINT news_backlog_origem_check
    CHECK (origem IN ('manual_link', 'external', 'scraped_approved'));

ALTER TABLE ap.news_backlog DROP CONSTRAINT IF EXISTS news_backlog_status_check;
ALTER TABLE ap.news_backlog
    ADD CONSTRAINT news_backlog_status_check
    CHECK (status IN ('available', 'adopted', 'in_production', 'completed', 'archived'));

ALTER TABLE ap.news_backlog DROP CONSTRAINT IF EXISTS news_backlog_adoption_consistency_check;
ALTER TABLE ap.news_backlog
    ADD CONSTRAINT news_backlog_adoption_consistency_check
    CHECK (
        (status = 'available' AND adopted_by_user_id IS NULL AND adopted_at IS NULL)
        OR (status IN ('adopted', 'in_production', 'completed') AND adopted_by_user_id IS NOT NULL AND adopted_at IS NOT NULL)
        OR status = 'archived'
    );

ALTER TABLE ap.news_backlog_events DROP CONSTRAINT IF EXISTS news_backlog_event_action_check;
ALTER TABLE ap.news_backlog_events
    ADD CONSTRAINT news_backlog_event_action_check
    CHECK (action IN (
        'created', 'approved_from_collection', 'adopted', 'released',
        'production_started', 'linked', 'production_completed',
        'discarded', 'title_updated'
    ));

CREATE OR REPLACE FUNCTION ap.approve_collected_news(
    p_cliente_id uuid,
    p_collected_news_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor record;
    v_collected ap.collected_news%ROWTYPE;
    v_existing ap.news_backlog%ROWTYPE;
    v_backlog ap.news_backlog%ROWTYPE;
BEGIN
    SELECT * INTO v_actor FROM ap.require_editorial_admin_access(p_cliente_id);

    SELECT * INTO v_collected
    FROM ap.collected_news AS collected
    WHERE collected.id = p_collected_news_id
      AND collected.cliente_id = p_cliente_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'COLLECTED_NEWS_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    IF v_collected.status = 'approved' AND v_collected.news_backlog_id IS NOT NULL THEN
        SELECT * INTO v_backlog FROM ap.news_backlog WHERE id = v_collected.news_backlog_id;
        RETURN jsonb_build_object('created', false, 'item', to_jsonb(v_backlog));
    END IF;
    IF v_collected.status <> 'pending_review' THEN
        RAISE EXCEPTION 'COLLECTED_NEWS_NOT_PENDING' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_existing
    FROM ap.news_backlog AS backlog
    WHERE backlog.cliente_id = p_cliente_id
      AND backlog.normalized_url = v_collected.normalized_url;

    IF FOUND THEN
        UPDATE ap.collected_news
           SET status = 'duplicate', updated_at = now(),
               metadata = metadata || jsonb_build_object('duplicate_backlog_id', v_existing.id)
         WHERE id = v_collected.id;
        INSERT INTO ap.collected_news_events (
            collected_news_id, cliente_id, actor_user_id, action, metadata
        ) VALUES (
            v_collected.id, p_cliente_id, v_actor.user_id, 'duplicate',
            jsonb_build_object('backlog_id', v_existing.id)
        );
        RETURN jsonb_build_object(
            'created', false,
            'duplicate', true,
            'item', to_jsonb(v_existing)
        );
    END IF;

    INSERT INTO ap.news_backlog (
        cliente_id, url_original, normalized_url, url_normalization_version,
        titulo, observacao, origem, status,
        created_by_user_id, created_by_name_snapshot, collected_news_id
    ) VALUES (
        p_cliente_id, v_collected.canonical_url, v_collected.normalized_url, 1,
        v_collected.title, NULLIF(v_collected.excerpt, ''), 'scraped_approved', 'available',
        v_actor.user_id, NULLIF(btrim(v_actor.display_name), ''), v_collected.id
    ) RETURNING * INTO v_backlog;

    UPDATE ap.collected_news
       SET status = 'approved',
           approved_by_user_id = v_actor.user_id,
           approved_by_name_snapshot = NULLIF(btrim(v_actor.display_name), ''),
           approved_at = now(),
           news_backlog_id = v_backlog.id
     WHERE id = v_collected.id;

    INSERT INTO ap.collected_news_events (
        collected_news_id, cliente_id, actor_user_id, action, metadata
    ) VALUES (
        v_collected.id, p_cliente_id, v_actor.user_id, 'approved',
        jsonb_build_object('backlog_id', v_backlog.id)
    );
    INSERT INTO ap.news_backlog_events (
        backlog_id, cliente_id, actor_user_id, action, metadata
    ) VALUES (
        v_backlog.id, p_cliente_id, v_actor.user_id, 'approved_from_collection',
        jsonb_build_object('collected_news_id', v_collected.id)
    );

    RETURN jsonb_build_object('created', true, 'item', to_jsonb(v_backlog));
END;
$function$;

CREATE OR REPLACE FUNCTION ap.discard_collected_news(
    p_cliente_id uuid,
    p_collected_news_id uuid,
    p_reason text DEFAULT NULL
)
RETURNS ap.collected_news
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor record;
    v_result ap.collected_news%ROWTYPE;
BEGIN
    SELECT * INTO v_actor FROM ap.require_editorial_admin_access(p_cliente_id);
    UPDATE ap.collected_news AS collected
       SET status = 'discarded',
           discarded_by_user_id = v_actor.user_id,
           discarded_by_name_snapshot = NULLIF(btrim(v_actor.display_name), ''),
           discarded_at = now(),
           discard_reason = NULLIF(btrim(p_reason), '')
     WHERE collected.id = p_collected_news_id
       AND collected.cliente_id = p_cliente_id
       AND collected.status = 'pending_review'
     RETURNING * INTO v_result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'COLLECTED_NEWS_NOT_PENDING' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO ap.collected_news_events (
        collected_news_id, cliente_id, actor_user_id, action, metadata
    ) VALUES (
        v_result.id, p_cliente_id, v_actor.user_id, 'discarded',
        jsonb_build_object('reason', NULLIF(btrim(p_reason), ''))
    );
    RETURN v_result;
END;
$function$;

-- Staff can adopt, but only an administrator can create or discard a shared item.
CREATE OR REPLACE FUNCTION ap.create_news_backlog_item(
    p_cliente_id uuid,
    p_url_original text,
    p_titulo text DEFAULT NULL,
    p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor record;
    v_url text := btrim(COALESCE(p_url_original, ''));
    v_normalized_url text;
    v_result ap.news_backlog%ROWTYPE;
    v_created boolean := false;
BEGIN
    SELECT * INTO v_actor FROM ap.require_editorial_admin_access(p_cliente_id);
    v_normalized_url := ap.normalize_news_backlog_url(v_url);
    INSERT INTO ap.news_backlog (
        cliente_id, url_original, normalized_url, url_normalization_version,
        titulo, observacao, created_by_user_id, created_by_name_snapshot
    ) VALUES (
        p_cliente_id, v_url, v_normalized_url, 1,
        NULLIF(btrim(p_titulo), ''), NULLIF(btrim(p_observacao), ''),
        v_actor.user_id, NULLIF(btrim(v_actor.display_name), '')
    )
    ON CONFLICT (cliente_id, normalized_url) DO NOTHING
    RETURNING * INTO v_result;

    IF FOUND THEN
        v_created := true;
        INSERT INTO ap.news_backlog_events (backlog_id, cliente_id, actor_user_id, action)
        VALUES (v_result.id, p_cliente_id, v_actor.user_id, 'created');
    ELSE
        SELECT * INTO v_result FROM ap.news_backlog
        WHERE cliente_id = p_cliente_id AND normalized_url = v_normalized_url;
    END IF;
    RETURN jsonb_build_object('created', v_created, 'item', to_jsonb(v_result));
END;
$function$;

CREATE OR REPLACE FUNCTION ap.discard_news_backlog_item(
    p_backlog_id uuid,
    p_cliente_id uuid
)
RETURNS ap.news_backlog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor record;
    v_result ap.news_backlog%ROWTYPE;
BEGIN
    SELECT * INTO v_actor FROM ap.require_editorial_admin_access(p_cliente_id);
    UPDATE ap.news_backlog AS backlog
       SET status = 'archived'
     WHERE backlog.id = p_backlog_id
       AND backlog.cliente_id = p_cliente_id
       AND backlog.status = 'available'
       AND backlog.candidate_news_id IS NULL
     RETURNING * INTO v_result;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BACKLOG_DISCARD_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    INSERT INTO ap.news_backlog_events (backlog_id, cliente_id, actor_user_id, action)
    VALUES (v_result.id, p_cliente_id, v_actor.user_id, 'discarded');
    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION ap.list_available_news_backlog(p_cliente_id uuid)
RETURNS SETOF ap.news_backlog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    PERFORM 1 FROM ap.require_news_backlog_access(p_cliente_id);
    RETURN QUERY
    SELECT backlog.* FROM ap.news_backlog AS backlog
    WHERE backlog.cliente_id = p_cliente_id AND backlog.status = 'available'
    ORDER BY backlog.created_at ASC, backlog.id ASC;
END;
$function$;

-- Compatibility endpoint: the shared bank now means available work only.
CREATE OR REPLACE FUNCTION ap.list_news_backlog(p_cliente_id uuid)
RETURNS TABLE (
    id uuid,
    cliente_id uuid,
    url_original text,
    normalized_url text,
    url_normalization_version smallint,
    titulo text,
    observacao text,
    origem text,
    status text,
    created_by_user_id uuid,
    created_by_name_snapshot text,
    created_at timestamptz,
    adopted_by_user_id uuid,
    adopted_by_name_snapshot text,
    adopted_at timestamptz,
    released_at timestamptz,
    candidate_news_id uuid,
    production_started_at timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    PERFORM 1 FROM ap.require_news_backlog_access(p_cliente_id);
    RETURN QUERY
    SELECT backlog.id, backlog.cliente_id, backlog.url_original,
           backlog.normalized_url, backlog.url_normalization_version,
           backlog.titulo, backlog.observacao, backlog.origem, backlog.status,
           backlog.created_by_user_id, backlog.created_by_name_snapshot,
           backlog.created_at, backlog.adopted_by_user_id,
           backlog.adopted_by_name_snapshot, backlog.adopted_at,
           backlog.released_at, backlog.candidate_news_id,
           backlog.production_started_at, backlog.updated_at
    FROM ap.news_backlog AS backlog
    WHERE backlog.cliente_id = p_cliente_id
      AND backlog.status = 'available'
    ORDER BY backlog.created_at ASC, backlog.id ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION ap.list_my_news_work(p_cliente_id uuid)
RETURNS SETOF ap.news_backlog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor record;
BEGIN
    SELECT * INTO v_actor FROM ap.require_news_backlog_access(p_cliente_id);
    RETURN QUERY
    SELECT backlog.* FROM ap.news_backlog AS backlog
    WHERE backlog.cliente_id = p_cliente_id
      AND backlog.adopted_by_user_id = v_actor.user_id
      AND backlog.status IN ('adopted', 'in_production', 'completed')
    ORDER BY
        CASE backlog.status WHEN 'adopted' THEN 0 WHEN 'in_production' THEN 1 ELSE 2 END,
        backlog.updated_at DESC, backlog.id DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION ap.list_team_news_work(p_cliente_id uuid)
RETURNS SETOF ap.news_backlog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    PERFORM 1 FROM ap.require_editorial_admin_access(p_cliente_id);
    RETURN QUERY
    SELECT backlog.* FROM ap.news_backlog AS backlog
    WHERE backlog.cliente_id = p_cliente_id
      AND backlog.status IN ('adopted', 'in_production', 'completed')
    ORDER BY backlog.updated_at DESC, backlog.id DESC;
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

-- ---------------------------------------------------------------------------
-- Immutable production and OS completion attribution
-- ---------------------------------------------------------------------------

CREATE TABLE ap.material_production_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_news_id uuid NOT NULL UNIQUE REFERENCES ap.candidate_news(id) ON DELETE CASCADE,
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    creator_user_id uuid NOT NULL REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    creator_name_snapshot text,
    produced_at timestamptz NOT NULL,
    content_type text,
    source_kind text NOT NULL DEFAULT 'candidate_render',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_material_production_events_creator_date
    ON ap.material_production_events (cliente_id, creator_user_id, produced_at DESC);
ALTER TABLE ap.material_production_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ap.material_production_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE ap.material_production_events TO service_role;

CREATE OR REPLACE FUNCTION ap.capture_material_production()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF NEW.criado_por_user_id IS NOT NULL
       AND EXISTS (
           SELECT 1
           FROM public.profissionais AS professional
           WHERE professional.id = NEW.criado_por_user_id
       )
       AND NULLIF(btrim(COALESCE(NEW.render_url, '')), '') IS NOT NULL
       AND NEW.completed_at IS NOT NULL THEN
        INSERT INTO ap.material_production_events (
            candidate_news_id, cliente_id, creator_user_id,
            creator_name_snapshot, produced_at, content_type
        ) VALUES (
            NEW.id, NEW.cliente_id, NEW.criado_por_user_id,
            NEW.creator_name_snapshot, NEW.completed_at, NEW.content_type
        ) ON CONFLICT (candidate_news_id) DO NOTHING;

        UPDATE ap.news_backlog AS backlog
           SET status = 'completed',
               production_completed_at = COALESCE(backlog.production_completed_at, NEW.completed_at),
               completed_by_user_id = COALESCE(backlog.completed_by_user_id, NEW.criado_por_user_id),
               completed_by_name_snapshot = COALESCE(backlog.completed_by_name_snapshot, NEW.creator_name_snapshot)
         WHERE backlog.candidate_news_id = NEW.id
           AND backlog.status IN ('adopted', 'in_production');

        INSERT INTO ap.news_backlog_events (
            backlog_id, cliente_id, actor_user_id, action, metadata
        )
        SELECT backlog.id, backlog.cliente_id, NEW.criado_por_user_id,
               'production_completed', jsonb_build_object('candidate_news_id', NEW.id)
        FROM ap.news_backlog AS backlog
        WHERE backlog.candidate_news_id = NEW.id
          AND NOT EXISTS (
              SELECT 1 FROM ap.news_backlog_events event
              WHERE event.backlog_id = backlog.id
                AND event.action = 'production_completed'
          );
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION ap.capture_material_production() FROM PUBLIC;
CREATE TRIGGER trg_capture_material_production
AFTER INSERT OR UPDATE OF render_url, completed_at ON ap.candidate_news
FOR EACH ROW EXECUTE FUNCTION ap.capture_material_production();

INSERT INTO ap.material_production_events (
    candidate_news_id, cliente_id, creator_user_id,
    creator_name_snapshot, produced_at, content_type
)
SELECT candidate.id, candidate.cliente_id, candidate.criado_por_user_id,
       candidate.creator_name_snapshot, candidate.completed_at, candidate.content_type
FROM ap.candidate_news AS candidate
JOIN public.profissionais AS creator
  ON creator.id = candidate.criado_por_user_id
WHERE candidate.criado_por_user_id IS NOT NULL
  AND NULLIF(btrim(COALESCE(candidate.render_url, '')), '') IS NOT NULL
  AND candidate.completed_at IS NOT NULL
ON CONFLICT (candidate_news_id) DO NOTHING;

UPDATE ap.news_backlog AS backlog
SET status = CASE
        WHEN candidate.completed_at IS NOT NULL
         AND NULLIF(btrim(COALESCE(candidate.render_url, '')), '') IS NOT NULL
            THEN 'completed'
        ELSE 'in_production'
    END,
    production_completed_at = CASE
        WHEN candidate.completed_at IS NOT NULL
         AND NULLIF(btrim(COALESCE(candidate.render_url, '')), '') IS NOT NULL
            THEN candidate.completed_at
        ELSE backlog.production_completed_at
    END,
    completed_by_user_id = CASE
        WHEN candidate.completed_at IS NOT NULL
         AND NULLIF(btrim(COALESCE(candidate.render_url, '')), '') IS NOT NULL
            THEN candidate.criado_por_user_id
        ELSE backlog.completed_by_user_id
    END,
    completed_by_name_snapshot = CASE
        WHEN candidate.completed_at IS NOT NULL
         AND NULLIF(btrim(COALESCE(candidate.render_url, '')), '') IS NOT NULL
            THEN candidate.creator_name_snapshot
        ELSE backlog.completed_by_name_snapshot
    END
FROM ap.candidate_news AS candidate
WHERE backlog.candidate_news_id = candidate.id
  AND backlog.status = 'adopted';

ALTER TABLE public.tarefas
    ADD COLUMN IF NOT EXISTS completed_by_user_id uuid REFERENCES public.profissionais(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS completed_by_name_snapshot text,
    ADD COLUMN IF NOT EXISTS completion_source text;

ALTER TABLE public.tarefas DROP CONSTRAINT IF EXISTS tarefas_completion_source_check;
ALTER TABLE public.tarefas
    ADD CONSTRAINT tarefas_completion_source_check
    CHECK (completion_source IS NULL OR completion_source IN ('human', 'automatic', 'legacy_unattributed'));

CREATE INDEX IF NOT EXISTS idx_tarefas_cliente_completed_actor_date
    ON public.tarefas (cliente_id, completed_by_user_id, concluida_at DESC)
    WHERE status = 'concluida' AND completed_by_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tarefas_cliente_assignee_open
    ON public.tarefas (cliente_id, assigned_to)
    WHERE deleted_at IS NULL AND status IN ('pendente', 'em_execucao', 'atrasada');

UPDATE public.tarefas
SET concluida_at = completed_at
WHERE status = 'concluida' AND concluida_at IS NULL AND completed_at IS NOT NULL;
UPDATE public.tarefas
SET completion_source = 'legacy_unattributed'
WHERE status = 'concluida' AND completion_source IS NULL;

CREATE OR REPLACE FUNCTION public.capture_task_completion_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor uuid := auth.uid();
    v_name text;
BEGIN
    IF NEW.status = 'concluida'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'concluida') THEN
        NEW.concluida_at := COALESCE(NEW.concluida_at, NEW.completed_at, now());
        NEW.completed_at := COALESCE(NEW.completed_at, NEW.concluida_at);
        IF v_actor IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.profissionais p WHERE p.id = v_actor AND p.ativo IS TRUE
        ) THEN
            SELECT p.nome INTO v_name FROM public.profissionais p WHERE p.id = v_actor;
            NEW.completed_by_user_id := v_actor;
            NEW.completed_by_name_snapshot := NULLIF(btrim(v_name), '');
            NEW.completion_source := 'human';
        ELSE
            NEW.completed_by_user_id := NULL;
            NEW.completed_by_name_snapshot := NULL;
            NEW.completion_source := 'automatic';
        END IF;
    ELSIF TG_OP = 'UPDATE'
          AND NEW.status <> 'concluida'
          AND OLD.status = 'concluida' THEN
        NEW.concluida_at := NULL;
        NEW.completed_at := NULL;
        NEW.completed_by_user_id := NULL;
        NEW.completed_by_name_snapshot := NULL;
        NEW.completion_source := NULL;
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.capture_task_completion_actor() FROM PUBLIC;
CREATE TRIGGER trg_capture_task_completion_actor
BEFORE INSERT OR UPDATE OF status ON public.tarefas
FOR EACH ROW EXECUTE FUNCTION public.capture_task_completion_actor();

CREATE OR REPLACE FUNCTION public.registrar_evento_status_alterado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor uuid := auth.uid();
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        IF v_actor IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.profissionais p WHERE p.id = v_actor
        ) THEN
            v_actor := NULL;
        END IF;
        INSERT INTO public.os_eventos (os_id, tipo, autor_id, metadata)
        VALUES (
            NEW.id, 'status_alterado', v_actor,
            jsonb_build_object(
                'status_anterior', OLD.status,
                'status_novo', NEW.status,
                'completion_source', CASE WHEN NEW.status = 'concluida' THEN NEW.completion_source ELSE NULL END
            )
        );
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Falha ao registrar evento status_alterado para OS %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_evento_status_alterado() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin-only productivity report
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ap.get_staff_productivity_report(
    p_cliente_id uuid,
    p_start timestamptz,
    p_end timestamptz,
    p_timezone text DEFAULT 'America/Sao_Paulo'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_staff jsonb;
    v_legacy integer;
BEGIN
    PERFORM 1 FROM ap.require_editorial_admin_access(p_cliente_id);
    IF p_start IS NULL OR p_end IS NULL OR p_start >= p_end THEN
        RAISE EXCEPTION 'REPORT_RANGE_INVALID' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
        RAISE EXCEPTION 'REPORT_TIMEZONE_INVALID' USING ERRCODE = '22023';
    END IF;

    WITH client_context AS (
        SELECT client.id AS cliente_id, client.empresa_id,
               COALESCE(company.tenant_id, company.id) AS tenant_empresa_id
        FROM public.clientes client
        LEFT JOIN public.empresas company ON company.id = client.empresa_id
        WHERE client.id = p_cliente_id
    ), members AS (
        SELECT DISTINCT professional.id, professional.nome, professional.last_activity_at
        FROM public.profissionais professional
        CROSS JOIN client_context context
        WHERE professional.ativo IS TRUE
          AND professional.role IN ('admin', 'staff')
          AND (
              EXISTS (
                  SELECT 1 FROM public.cliente_profissionais membership
                  WHERE membership.cliente_id = p_cliente_id
                    AND membership.profissional_id = professional.id
                    AND membership.ativo IS TRUE
              )
              OR EXISTS (
                  SELECT 1 FROM public.empresa_profissionais membership
                  WHERE membership.profissional_id = professional.id
                    AND membership.ativo IS TRUE
                    AND membership.empresa_id IN (context.empresa_id, context.tenant_empresa_id)
              )
          )
    ), report_rows AS (
        SELECT member.id, member.nome,
            (SELECT count(*) FROM public.tarefas task
             WHERE task.cliente_id = p_cliente_id
               AND task.assigned_to = member.id
               AND task.deleted_at IS NULL
               AND task.status IN ('pendente', 'em_execucao', 'atrasada')) AS os_in_progress,
            (SELECT count(*) FROM public.tarefas task
             WHERE task.cliente_id = p_cliente_id
               AND task.completed_by_user_id = member.id
               AND task.status = 'concluida'
               AND task.concluida_at >= p_start AND task.concluida_at < p_end) AS os_completed,
            (SELECT count(*) FROM public.tarefas_micro micro
             JOIN public.tarefas task ON task.id = micro.tarefa_id
             WHERE task.cliente_id = p_cliente_id
               AND micro.profissional_id = member.id
               AND micro.status = 'concluida'
               AND micro.finished_at >= p_start AND micro.finished_at < p_end) AS micro_completed,
            (SELECT count(*) FROM ap.news_backlog backlog
             WHERE backlog.cliente_id = p_cliente_id
               AND backlog.adopted_by_user_id = member.id
               AND backlog.status = 'adopted') AS articles_adopted,
            (SELECT count(*) FROM ap.news_backlog backlog
             WHERE backlog.cliente_id = p_cliente_id
               AND backlog.adopted_by_user_id = member.id
               AND backlog.status = 'in_production') AS articles_in_production,
            (SELECT count(*) FROM ap.material_production_events event
             WHERE event.cliente_id = p_cliente_id
               AND event.creator_user_id = member.id
               AND event.produced_at >= p_start AND event.produced_at < p_end) AS articles_completed,
            (SELECT count(*) FROM ap.material_production_events event
             WHERE event.cliente_id = p_cliente_id
               AND event.creator_user_id = member.id
               AND (event.produced_at AT TIME ZONE p_timezone)::date = (now() AT TIME ZONE p_timezone)::date) AS articles_today,
            COALESCE((
                SELECT jsonb_agg(jsonb_build_object('date', daily.day, 'count', daily.total) ORDER BY daily.day)
                FROM (
                    SELECT (event.produced_at AT TIME ZONE p_timezone)::date AS day, count(*) AS total
                    FROM ap.material_production_events event
                    WHERE event.cliente_id = p_cliente_id
                      AND event.creator_user_id = member.id
                      AND event.produced_at >= p_start AND event.produced_at < p_end
                    GROUP BY (event.produced_at AT TIME ZONE p_timezone)::date
                ) daily
            ), '[]'::jsonb) AS daily_articles,
            (SELECT max(activity_at) FROM (VALUES
                (member.last_activity_at),
                ((SELECT max(task.concluida_at) FROM public.tarefas task
                  WHERE task.completed_by_user_id = member.id AND task.cliente_id = p_cliente_id)),
                ((SELECT max(event.produced_at) FROM ap.material_production_events event
                  WHERE event.creator_user_id = member.id AND event.cliente_id = p_cliente_id)),
                ((SELECT max(backlog.updated_at) FROM ap.news_backlog backlog
                  WHERE backlog.adopted_by_user_id = member.id AND backlog.cliente_id = p_cliente_id))
            ) AS activity(activity_at)) AS last_activity
        FROM members member
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'staff_id', row.id,
        'staff_name', row.nome,
        'os_in_progress', row.os_in_progress,
        'os_completed', row.os_completed,
        'micro_completed', row.micro_completed,
        'articles_adopted', row.articles_adopted,
        'articles_in_production', row.articles_in_production,
        'articles_completed', row.articles_completed,
        'articles_today', row.articles_today,
        'daily_articles', row.daily_articles,
        'last_activity', row.last_activity
    ) ORDER BY row.os_completed DESC, row.articles_completed DESC, row.nome), '[]'::jsonb)
    INTO v_staff FROM report_rows row;

    SELECT count(*) INTO v_legacy
    FROM public.tarefas task
    WHERE task.cliente_id = p_cliente_id
      AND task.status = 'concluida'
      AND task.concluida_at >= p_start AND task.concluida_at < p_end
      AND task.completed_by_user_id IS NULL;

    RETURN jsonb_build_object(
        'start', p_start,
        'end', p_end,
        'timezone', p_timezone,
        'legacy_unattributed_os', v_legacy,
        'staff', v_staff
    );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION ap.require_editorial_admin_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.ingest_collected_news(uuid, uuid, text, text, text, text, text, text, timestamptz, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION ap.list_collected_news(uuid, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.get_collected_news_counts(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.approve_collected_news(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.discard_collected_news(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.list_available_news_backlog(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.list_news_backlog(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.list_my_news_work(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.list_team_news_work(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.get_staff_productivity_report(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION ap.ingest_collected_news(uuid, uuid, text, text, text, text, text, text, timestamptz, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION ap.list_collected_news(uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.get_collected_news_counts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.approve_collected_news(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.discard_collected_news(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.list_available_news_backlog(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.list_news_backlog(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.list_my_news_work(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.list_team_news_work(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.get_staff_productivity_report(uuid, timestamptz, timestamptz, text) TO authenticated;

-- Re-grant changed legacy signatures after the P0 default-privilege lockdown.
REVOKE ALL ON FUNCTION ap.create_news_backlog_item(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.discard_news_backlog_item(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.link_news_backlog_candidate(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ap.create_news_backlog_item(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.discard_news_backlog_item(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.link_news_backlog_candidate(uuid, uuid, uuid, uuid, text) TO service_role;

COMMENT ON TABLE ap.collected_news IS
    'Admin-curated staging inbox for scraped articles. It is isolated from candidate_news.';
COMMENT ON FUNCTION ap.approve_collected_news(uuid, uuid) IS
    'Atomic admin approval that creates one available shared-backlog item and no production candidate.';
COMMENT ON FUNCTION ap.get_staff_productivity_report(uuid, timestamptz, timestamptz, text) IS
    'Tenant-scoped admin report with certified OS completion actors and immutable material-production events.';

COMMIT;
