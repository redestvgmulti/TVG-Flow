-- Shared editorial backlog. This is intentionally separate from ap.candidate_news:
-- a submitted link must not enter the ingestion/scoring/render pipeline until its
-- adopter explicitly starts production through the existing generator.

CREATE TABLE ap.news_backlog (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    url_original text NOT NULL,
    titulo text,
    observacao text,
    origem text NOT NULL DEFAULT 'manual_link',
    status text NOT NULL DEFAULT 'available',
    created_by_user_id uuid NOT NULL REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    created_by_name_snapshot text,
    created_at timestamptz NOT NULL DEFAULT now(),
    adopted_by_user_id uuid REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    adopted_by_name_snapshot text,
    adopted_at timestamptz,
    released_by_user_id uuid REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    released_at timestamptz,
    candidate_news_id uuid REFERENCES ap.candidate_news(id) ON DELETE SET NULL,
    production_started_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT news_backlog_url_http_check
        CHECK (url_original ~* '^https?://'),
    CONSTRAINT news_backlog_origem_check
        CHECK (origem IN ('manual_link', 'external')),
    CONSTRAINT news_backlog_status_check
        CHECK (status IN ('available', 'adopted', 'archived')),
    CONSTRAINT news_backlog_adoption_consistency_check
        CHECK (
            (status = 'available' AND adopted_by_user_id IS NULL AND adopted_at IS NULL)
            OR
            (status IN ('adopted', 'archived') AND adopted_by_user_id IS NOT NULL AND adopted_at IS NOT NULL)
        )
);

CREATE TABLE ap.news_backlog_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    backlog_id uuid NOT NULL REFERENCES ap.news_backlog(id) ON DELETE CASCADE,
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    actor_user_id uuid NOT NULL REFERENCES public.profissionais(id) ON DELETE RESTRICT,
    action text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT news_backlog_event_action_check
        CHECK (action IN ('created', 'adopted', 'released', 'production_started'))
);

CREATE INDEX idx_news_backlog_cliente_status_created
    ON ap.news_backlog (cliente_id, status, created_at DESC);

CREATE INDEX idx_news_backlog_adopted_by
    ON ap.news_backlog (adopted_by_user_id, updated_at DESC)
    WHERE adopted_by_user_id IS NOT NULL;

CREATE UNIQUE INDEX uq_news_backlog_candidate
    ON ap.news_backlog (candidate_news_id)
    WHERE candidate_news_id IS NOT NULL;

CREATE INDEX idx_news_backlog_events_backlog_created
    ON ap.news_backlog_events (backlog_id, created_at DESC);

CREATE OR REPLACE FUNCTION ap.set_news_backlog_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION ap.set_news_backlog_updated_at() FROM PUBLIC;

CREATE TRIGGER trg_news_backlog_updated_at
BEFORE UPDATE ON ap.news_backlog
FOR EACH ROW
EXECUTE FUNCTION ap.set_news_backlog_updated_at();

ALTER TABLE ap.news_backlog ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.news_backlog_events ENABLE ROW LEVEL SECURITY;

-- No browser role receives direct table access. The narrowly scoped RPCs below
-- derive the actor from auth.uid() and validate the operational client first.
REVOKE ALL ON TABLE ap.news_backlog FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE ap.news_backlog_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE ap.news_backlog TO service_role;
GRANT ALL ON TABLE ap.news_backlog_events TO service_role;

CREATE OR REPLACE FUNCTION ap.require_news_backlog_access(p_cliente_id uuid)
RETURNS TABLE (user_id uuid, role text, display_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap, public, pg_temp
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
      AND professional.role IN ('admin', 'staff')
      AND EXISTS (
          SELECT 1
          FROM ap.get_operational_cliente_ids() AS allowed(cliente_id)
          WHERE allowed.cliente_id = p_cliente_id
      );

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BACKLOG_TENANT_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION ap.list_news_backlog(p_cliente_id uuid)
RETURNS TABLE (
    id uuid,
    cliente_id uuid,
    url_original text,
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
    production_started_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap, public, pg_temp
AS $function$
BEGIN
    PERFORM 1 FROM ap.require_news_backlog_access(p_cliente_id);

    RETURN QUERY
    SELECT
        backlog.id,
        backlog.cliente_id,
        backlog.url_original,
        backlog.titulo,
        backlog.observacao,
        backlog.origem,
        backlog.status,
        backlog.created_by_user_id,
        backlog.created_by_name_snapshot,
        backlog.created_at,
        backlog.adopted_by_user_id,
        backlog.adopted_by_name_snapshot,
        backlog.adopted_at,
        backlog.released_at,
        backlog.candidate_news_id,
        backlog.production_started_at
    FROM ap.news_backlog AS backlog
    WHERE backlog.cliente_id = p_cliente_id
    ORDER BY
        CASE backlog.status WHEN 'available' THEN 0 WHEN 'adopted' THEN 1 ELSE 2 END,
        backlog.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION ap.create_news_backlog_item(
    p_cliente_id uuid,
    p_url_original text,
    p_titulo text DEFAULT NULL,
    p_observacao text DEFAULT NULL
)
RETURNS ap.news_backlog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap, public, pg_temp
AS $function$
DECLARE
    v_actor record;
    v_url text := btrim(COALESCE(p_url_original, ''));
    v_result ap.news_backlog%ROWTYPE;
BEGIN
    SELECT * INTO v_actor FROM ap.require_news_backlog_access(p_cliente_id);

    IF length(v_url) > 2048 OR v_url !~* '^https?://[^[:space:]]+$' THEN
        RAISE EXCEPTION 'BACKLOG_URL_INVALID' USING ERRCODE = '22023';
    END IF;

    INSERT INTO ap.news_backlog (
        cliente_id, url_original, titulo, observacao,
        created_by_user_id, created_by_name_snapshot
    ) VALUES (
        p_cliente_id,
        v_url,
        NULLIF(btrim(p_titulo), ''),
        NULLIF(btrim(p_observacao), ''),
        v_actor.user_id,
        NULLIF(btrim(v_actor.display_name), '')
    )
    RETURNING * INTO v_result;

    INSERT INTO ap.news_backlog_events (backlog_id, cliente_id, actor_user_id, action)
    VALUES (v_result.id, p_cliente_id, v_actor.user_id, 'created');

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION ap.adopt_news_backlog_item(
    p_backlog_id uuid,
    p_cliente_id uuid
)
RETURNS ap.news_backlog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap, public, pg_temp
AS $function$
DECLARE
    v_actor record;
    v_result ap.news_backlog%ROWTYPE;
BEGIN
    SELECT * INTO v_actor FROM ap.require_news_backlog_access(p_cliente_id);

    IF NOT EXISTS (
        SELECT 1 FROM ap.news_backlog
        WHERE id = p_backlog_id AND cliente_id = p_cliente_id
    ) THEN
        RAISE EXCEPTION 'BACKLOG_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    UPDATE ap.news_backlog AS backlog
       SET status = 'adopted',
           adopted_by_user_id = v_actor.user_id,
           adopted_by_name_snapshot = NULLIF(btrim(v_actor.display_name), ''),
           adopted_at = now(),
           released_by_user_id = NULL,
           released_at = NULL
     WHERE backlog.id = p_backlog_id
       AND backlog.cliente_id = p_cliente_id
       AND backlog.status = 'available'
       AND backlog.adopted_by_user_id IS NULL
       AND backlog.candidate_news_id IS NULL
     RETURNING * INTO v_result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BACKLOG_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO ap.news_backlog_events (backlog_id, cliente_id, actor_user_id, action)
    VALUES (v_result.id, p_cliente_id, v_actor.user_id, 'adopted');

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION ap.release_news_backlog_item(
    p_backlog_id uuid,
    p_cliente_id uuid
)
RETURNS ap.news_backlog
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap, public, pg_temp
AS $function$
DECLARE
    v_actor record;
    v_result ap.news_backlog%ROWTYPE;
BEGIN
    SELECT * INTO v_actor FROM ap.require_news_backlog_access(p_cliente_id);

    UPDATE ap.news_backlog AS backlog
       SET status = 'available',
           adopted_by_user_id = NULL,
           adopted_by_name_snapshot = NULL,
           adopted_at = NULL,
           released_by_user_id = v_actor.user_id,
           released_at = now()
     WHERE backlog.id = p_backlog_id
       AND backlog.cliente_id = p_cliente_id
       AND backlog.status = 'adopted'
       AND backlog.adopted_by_user_id = v_actor.user_id
       AND backlog.candidate_news_id IS NULL
     RETURNING * INTO v_result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BACKLOG_RELEASE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    INSERT INTO ap.news_backlog_events (backlog_id, cliente_id, actor_user_id, action)
    VALUES (v_result.id, p_cliente_id, v_actor.user_id, 'released');

    RETURN v_result;
END;
$function$;

-- Called with the user's JWT immediately before candidate creation. It does
-- not mutate the backlog; it proves that this user still owns this source.
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

-- Called only by the authenticated Edge Function after candidate creation.
-- The binding is idempotent for retries with the same candidate and never
-- accepts a candidate created by another actor or another operational client.
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
SET search_path = pg_catalog, ap, public, pg_temp
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
        SELECT 1
        FROM ap.candidate_news AS candidate
        WHERE candidate.id = p_candidate_id
          AND candidate.cliente_id = p_cliente_id
          AND candidate.criado_por_user_id = p_actor_user_id
          AND candidate.url_original = v_url
    ) THEN
        RAISE EXCEPTION 'BACKLOG_CANDIDATE_MISMATCH' USING ERRCODE = '42501';
    END IF;

    UPDATE ap.news_backlog AS backlog
       SET candidate_news_id = p_candidate_id,
           production_started_at = COALESCE(backlog.production_started_at, now())
     WHERE backlog.id = p_backlog_id
       AND backlog.cliente_id = p_cliente_id
       AND backlog.status = 'adopted'
       AND backlog.adopted_by_user_id = p_actor_user_id
       AND backlog.url_original = v_url
       AND (backlog.candidate_news_id IS NULL OR backlog.candidate_news_id = p_candidate_id)
     RETURNING * INTO v_result;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BACKLOG_LINK_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    INSERT INTO ap.news_backlog_events (
        backlog_id, cliente_id, actor_user_id, action, metadata
    )
    SELECT
        v_result.id,
        p_cliente_id,
        p_actor_user_id,
        'production_started',
        jsonb_build_object('candidate_news_id', p_candidate_id)
    WHERE NOT EXISTS (
        SELECT 1
        FROM ap.news_backlog_events AS event
        WHERE event.backlog_id = v_result.id
          AND event.action = 'production_started'
          AND event.metadata ->> 'candidate_news_id' = p_candidate_id::text
    );

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION ap.require_news_backlog_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.list_news_backlog(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.create_news_backlog_item(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.adopt_news_backlog_item(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.release_news_backlog_item(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.assert_news_backlog_production_access(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.link_news_backlog_candidate(uuid, uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION ap.list_news_backlog(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.create_news_backlog_item(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.adopt_news_backlog_item(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.release_news_backlog_item(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.assert_news_backlog_production_access(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.link_news_backlog_candidate(uuid, uuid, uuid, uuid, text) TO service_role;

COMMENT ON TABLE ap.news_backlog IS
    'Prospective shared editorial backlog. It remains separate from candidate_news until an adopter starts production.';
COMMENT ON FUNCTION ap.adopt_news_backlog_item(uuid, uuid) IS
    'Atomic compare-and-set adoption: only one available backlog item claimant can succeed.';
