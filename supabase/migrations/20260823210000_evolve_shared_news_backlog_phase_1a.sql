-- Phase 1A: evolve the existing shared backlog without starting scraping or
-- mutating the editorial production pipeline.

ALTER TABLE ap.system_config
    ADD COLUMN IF NOT EXISTS shared_news_backlog_enabled boolean
    NOT NULL DEFAULT false;

-- Preserve access for every tenant that already has an AutoPublisher config or
-- backlog data. New tenants remain disabled until explicitly rolled out.
UPDATE ap.system_config
SET shared_news_backlog_enabled = true
WHERE shared_news_backlog_enabled IS FALSE;

INSERT INTO ap.system_config (cliente_id, shared_news_backlog_enabled)
SELECT DISTINCT backlog.cliente_id, true
FROM ap.news_backlog AS backlog
ON CONFLICT (cliente_id) DO UPDATE
SET shared_news_backlog_enabled = EXCLUDED.shared_news_backlog_enabled;

COMMENT ON COLUMN ap.system_config.shared_news_backlog_enabled IS
    'Tenant rollout flag for the shared editorial link backlog. New tenants are disabled by default.';

CREATE OR REPLACE FUNCTION ap.normalize_news_backlog_url(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $function$
DECLARE
    v_url text := btrim(p_url);
    v_scheme text;
    v_remainder text;
    v_authority text;
    v_host text;
    v_port text;
    v_path_query text;
    v_path text;
    v_query text;
    v_piece text;
    v_key text;
    v_kept_query text[] := ARRAY[]::text[];
    v_query_position integer;
    v_closing_bracket integer;
BEGIN
    IF length(v_url) = 0
       OR length(v_url) > 2048
       OR v_url ~ '[[:space:]]' THEN
        RAISE EXCEPTION 'BACKLOG_URL_INVALID' USING ERRCODE = '22023';
    END IF;

    v_scheme := lower(substring(v_url FROM '^([A-Za-z][A-Za-z0-9+.-]*)://'));
    IF v_scheme IS NULL OR v_scheme NOT IN ('http', 'https') THEN
        RAISE EXCEPTION 'BACKLOG_URL_INVALID' USING ERRCODE = '22023';
    END IF;

    v_remainder := regexp_replace(v_url, '^[A-Za-z][A-Za-z0-9+.-]*://', '', 'i');
    v_remainder := split_part(v_remainder, '#', 1);
    v_authority := substring(v_remainder FROM '^[^/?]+');

    IF v_authority IS NULL
       OR v_authority = ''
       OR position('@' IN v_authority) > 0 THEN
        RAISE EXCEPTION 'BACKLOG_URL_INVALID' USING ERRCODE = '22023';
    END IF;

    v_path_query := substring(v_remainder FROM length(v_authority) + 1);

    IF left(v_authority, 1) = '[' THEN
        v_closing_bracket := position(']' IN v_authority);
        IF v_closing_bracket < 3 THEN
            RAISE EXCEPTION 'BACKLOG_URL_INVALID' USING ERRCODE = '22023';
        END IF;
        v_host := lower(left(v_authority, v_closing_bracket));
        IF length(v_authority) > v_closing_bracket THEN
            IF substring(v_authority FROM v_closing_bracket + 1 FOR 1) <> ':' THEN
                RAISE EXCEPTION 'BACKLOG_URL_INVALID' USING ERRCODE = '22023';
            END IF;
            v_port := substring(v_authority FROM v_closing_bracket + 2);
        END IF;
    ELSE
        v_host := lower(substring(v_authority FROM '^([^:]+)'));
        IF v_authority ~ ':' THEN
            v_port := substring(v_authority FROM ':([0-9]+)$');
            IF v_port IS NULL OR v_authority !~ '^[^:]+:[0-9]+$' THEN
                RAISE EXCEPTION 'BACKLOG_URL_INVALID' USING ERRCODE = '22023';
            END IF;
        END IF;
    END IF;

    IF v_host IS NULL
       OR v_host = ''
       OR v_host ~ '[[:space:]/?#]' THEN
        RAISE EXCEPTION 'BACKLOG_URL_INVALID' USING ERRCODE = '22023';
    END IF;

    IF v_port IS NOT NULL THEN
        IF v_port = '' OR v_port::numeric > 65535 THEN
            RAISE EXCEPTION 'BACKLOG_URL_INVALID' USING ERRCODE = '22023';
        END IF;
        IF (v_scheme = 'http' AND v_port = '80')
           OR (v_scheme = 'https' AND v_port = '443') THEN
            v_port := NULL;
        END IF;
    END IF;

    v_query_position := position('?' IN v_path_query);
    IF v_query_position > 0 THEN
        v_path := left(v_path_query, v_query_position - 1);
        v_query := substring(v_path_query FROM v_query_position + 1);
    ELSE
        v_path := v_path_query;
        v_query := NULL;
    END IF;

    IF v_path = '' THEN
        v_path := '/';
    ELSIF left(v_path, 1) <> '/' THEN
        RAISE EXCEPTION 'BACKLOG_URL_INVALID' USING ERRCODE = '22023';
    ELSIF v_path <> '/' THEN
        v_path := regexp_replace(v_path, '/+$', '');
        IF v_path = '' THEN
            v_path := '/';
        END IF;
    END IF;

    IF v_query IS NOT NULL AND v_query <> '' THEN
        FOREACH v_piece IN ARRAY string_to_array(v_query, '&') LOOP
            v_key := lower(split_part(v_piece, '=', 1));
            IF v_key NOT IN (
                'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
                'utm_content', 'fbclid', 'gclid'
            ) THEN
                v_kept_query := array_append(v_kept_query, v_piece);
            END IF;
        END LOOP;
    END IF;

    RETURN v_scheme || '://' || v_host
        || CASE WHEN v_port IS NULL THEN '' ELSE ':' || v_port END
        || v_path
        || CASE
            WHEN cardinality(v_kept_query) = 0 THEN ''
            ELSE '?' || array_to_string(v_kept_query, '&')
        END;
EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'BACKLOG_URL_INVALID' USING ERRCODE = '22023';
END;
$function$;

REVOKE ALL ON FUNCTION ap.normalize_news_backlog_url(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ap.normalize_news_backlog_url(text) TO service_role;

ALTER TABLE ap.news_backlog
    ADD COLUMN normalized_url text,
    ADD COLUMN url_normalization_version smallint NOT NULL DEFAULT 1;

UPDATE ap.news_backlog
SET normalized_url = ap.normalize_news_backlog_url(url_original)
WHERE normalized_url IS NULL;

DO $block$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM ap.news_backlog
        GROUP BY cliente_id, normalized_url
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'BACKLOG_NORMALIZED_DUPLICATES_REQUIRE_REVIEW';
    END IF;
END;
$block$;

ALTER TABLE ap.news_backlog
    ALTER COLUMN normalized_url SET NOT NULL,
    ADD CONSTRAINT news_backlog_normalization_version_check
        CHECK (url_normalization_version = 1);

CREATE UNIQUE INDEX uq_news_backlog_cliente_normalized_url
    ON ap.news_backlog (cliente_id, normalized_url);

CREATE OR REPLACE FUNCTION ap.set_news_backlog_normalized_url()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, ap
AS $function$
BEGIN
    NEW.url_original := btrim(NEW.url_original);
    NEW.normalized_url := ap.normalize_news_backlog_url(NEW.url_original);
    NEW.url_normalization_version := 1;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION ap.set_news_backlog_normalized_url() FROM PUBLIC;

CREATE TRIGGER trg_news_backlog_normalized_url
BEFORE INSERT OR UPDATE OF url_original ON ap.news_backlog
FOR EACH ROW
EXECUTE FUNCTION ap.set_news_backlog_normalized_url();

ALTER TABLE ap.news_backlog_events
    DROP CONSTRAINT news_backlog_event_action_check,
    ADD CONSTRAINT news_backlog_event_action_check
        CHECK (action IN ('created', 'adopted', 'released', 'production_started', 'linked'));

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

    IF NOT EXISTS (
        SELECT 1
        FROM ap.system_config AS config
        WHERE config.cliente_id = p_cliente_id
          AND config.shared_news_backlog_enabled IS TRUE
    ) THEN
        RAISE EXCEPTION 'BACKLOG_FEATURE_DISABLED' USING ERRCODE = '42501';
    END IF;
END;
$function$;

DROP FUNCTION ap.list_news_backlog(uuid);

CREATE FUNCTION ap.list_news_backlog(p_cliente_id uuid)
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
SET search_path = pg_catalog, ap, public, pg_temp
AS $function$
BEGIN
    PERFORM 1 FROM ap.require_news_backlog_access(p_cliente_id);

    RETURN QUERY
    SELECT
        backlog.id,
        backlog.cliente_id,
        backlog.url_original,
        backlog.normalized_url,
        backlog.url_normalization_version,
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
        backlog.production_started_at,
        backlog.updated_at
    FROM ap.news_backlog AS backlog
    WHERE backlog.cliente_id = p_cliente_id
    ORDER BY
        CASE backlog.status WHEN 'available' THEN 0 WHEN 'adopted' THEN 1 ELSE 2 END,
        backlog.created_at DESC;
END;
$function$;

DROP FUNCTION ap.create_news_backlog_item(uuid, text, text, text);

CREATE FUNCTION ap.create_news_backlog_item(
    p_cliente_id uuid,
    p_url_original text,
    p_titulo text DEFAULT NULL,
    p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ap, public, pg_temp
AS $function$
DECLARE
    v_actor record;
    v_url text := btrim(COALESCE(p_url_original, ''));
    v_normalized_url text;
    v_result ap.news_backlog%ROWTYPE;
    v_created boolean := false;
BEGIN
    SELECT * INTO v_actor FROM ap.require_news_backlog_access(p_cliente_id);
    v_normalized_url := ap.normalize_news_backlog_url(v_url);

    INSERT INTO ap.news_backlog (
        cliente_id, url_original, normalized_url, url_normalization_version,
        titulo, observacao, created_by_user_id, created_by_name_snapshot
    ) VALUES (
        p_cliente_id,
        v_url,
        v_normalized_url,
        1,
        NULLIF(btrim(p_titulo), ''),
        NULLIF(btrim(p_observacao), ''),
        v_actor.user_id,
        NULLIF(btrim(v_actor.display_name), '')
    )
    ON CONFLICT (cliente_id, normalized_url) DO NOTHING
    RETURNING * INTO v_result;

    IF FOUND THEN
        v_created := true;
        INSERT INTO ap.news_backlog_events (backlog_id, cliente_id, actor_user_id, action)
        VALUES (v_result.id, p_cliente_id, v_actor.user_id, 'created');
    ELSE
        SELECT * INTO v_result
        FROM ap.news_backlog AS backlog
        WHERE backlog.cliente_id = p_cliente_id
          AND backlog.normalized_url = v_normalized_url;
    END IF;

    RETURN jsonb_build_object(
        'created', v_created,
        'item', to_jsonb(v_result)
    );
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
        'linked',
        jsonb_build_object('candidate_news_id', p_candidate_id)
    WHERE NOT EXISTS (
        SELECT 1
        FROM ap.news_backlog_events AS event
        WHERE event.backlog_id = v_result.id
          AND event.action = 'linked'
          AND event.metadata ->> 'candidate_news_id' = p_candidate_id::text
    );

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION ap.list_news_backlog(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.create_news_backlog_item(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION ap.link_news_backlog_candidate(uuid, uuid, uuid, uuid, text)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION ap.list_news_backlog(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.create_news_backlog_item(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION ap.link_news_backlog_candidate(uuid, uuid, uuid, uuid, text)
    TO service_role;

COMMENT ON FUNCTION ap.normalize_news_backlog_url(text) IS
    'Normalization contract v1: no network access; preserves original URL and functional query parameters.';
COMMENT ON INDEX ap.uq_news_backlog_cliente_normalized_url IS
    'Prevents duplicate normalized links inside one operational tenant.';
