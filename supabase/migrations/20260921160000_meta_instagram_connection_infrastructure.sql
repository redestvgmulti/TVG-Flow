-- Meta / Instagram connection infrastructure.
-- Tokens never leave Vault through a frontend-readable table or RPC.

BEGIN;

CREATE TABLE ap.instagram_connections (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    provider text NOT NULL DEFAULT 'meta' CHECK (provider = 'meta'),
    status text NOT NULL DEFAULT 'disconnected'
        CHECK (status IN ('connected', 'disconnecting', 'disconnect_failed', 'disconnected', 'expired', 'error')),
    is_primary boolean NOT NULL DEFAULT false,
    facebook_user_id text,
    instagram_user_id text,
    instagram_username text,
    facebook_page_id text,
    facebook_page_name text,
    token_secret_ref uuid,
    revocation_secret_ref uuid,
    granted_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
    capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
    graph_api_version text NOT NULL CHECK (graph_api_version ~ '^v[0-9]+[.][0-9]+$'),
    connected_by_user_id uuid REFERENCES public.profissionais(id) ON DELETE SET NULL,
    connected_at timestamptz,
    last_validated_at timestamptz,
    expires_at timestamptz,
    last_error_code text,
    last_error_at timestamptz,
    disconnected_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT instagram_connection_connected_shape CHECK (
        status <> 'connected' OR (
            instagram_user_id IS NOT NULL AND instagram_username IS NOT NULL
            AND facebook_page_id IS NOT NULL AND token_secret_ref IS NOT NULL
            AND connected_at IS NOT NULL
        )
    ),
    CONSTRAINT instagram_connection_capabilities_shape CHECK (jsonb_typeof(capabilities) = 'object')
);

CREATE UNIQUE INDEX uq_instagram_connections_primary_connected
    ON ap.instagram_connections(cliente_id)
    WHERE is_primary AND status = 'connected';
ALTER TABLE ap.instagram_connections
    ADD CONSTRAINT uq_instagram_connections_meta_account
    UNIQUE (cliente_id, provider, instagram_user_id);
CREATE INDEX idx_instagram_connections_cliente_status
    ON ap.instagram_connections(cliente_id, status);

-- One durable epoch per Meta authorization. It is intentionally global to the
-- Meta user: a deauthorization invalidates OAuth material in every tenant.
CREATE TABLE ap.meta_authorizations (
    facebook_user_id text PRIMARY KEY,
    authorization_epoch bigint NOT NULL DEFAULT 0 CHECK (authorization_epoch >= 0),
    last_deauthorized_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ap.meta_oauth_states (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    state_hash text NOT NULL UNIQUE CHECK (state_hash ~ '^[a-f0-9]{64}$'),
    user_id uuid NOT NULL REFERENCES public.profissionais(id) ON DELETE CASCADE,
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    redirect_target text NOT NULL CHECK (redirect_target = '/admin/settings/integrations/meta/callback'),
    flow_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CONSTRAINT meta_oauth_state_expiry_check CHECK (expires_at > flow_started_at)
);
CREATE INDEX idx_meta_oauth_states_expiry ON ap.meta_oauth_states(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE ap.meta_oauth_selection_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profissionais(id) ON DELETE CASCADE,
    cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    graph_api_version text NOT NULL CHECK (graph_api_version ~ '^v[0-9]+[.][0-9]+$'),
    facebook_user_id text NOT NULL,
    user_token_secret_ref uuid NOT NULL,
    user_token_expires_at timestamptz,
    granted_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
    authorization_epoch bigint NOT NULL DEFAULT 0,
    flow_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CONSTRAINT meta_oauth_selection_expiry_check CHECK (expires_at > created_at)
);

CREATE TABLE ap.meta_oauth_selection_candidates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES ap.meta_oauth_selection_sessions(id) ON DELETE CASCADE,
    facebook_page_id text NOT NULL,
    facebook_page_name text NOT NULL,
    instagram_user_id text NOT NULL,
    instagram_username text NOT NULL,
    page_token_secret_ref uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(session_id, facebook_page_id, instagram_user_id)
);

ALTER TABLE ap.instagram_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.meta_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.meta_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.meta_oauth_selection_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ap.meta_oauth_selection_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ap.instagram_connections, ap.meta_authorizations, ap.meta_oauth_states,
    ap.meta_oauth_selection_sessions, ap.meta_oauth_selection_candidates
    FROM PUBLIC, anon, authenticated;
GRANT ALL ON ap.instagram_connections, ap.meta_authorizations, ap.meta_oauth_states,
    ap.meta_oauth_selection_sessions, ap.meta_oauth_selection_candidates TO service_role;

CREATE OR REPLACE FUNCTION ap.set_instagram_connection_updated_at()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END; $$;
CREATE TRIGGER set_instagram_connection_updated_at
BEFORE UPDATE ON ap.instagram_connections
FOR EACH ROW EXECUTE FUNCTION ap.set_instagram_connection_updated_at();

CREATE OR REPLACE FUNCTION ap.meta_create_secret(p_secret text, p_name text, p_description text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_secret_id uuid;
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF length(COALESCE(p_secret, '')) < 10 OR p_name !~ '^ap_meta_[a-z0-9_]{1,180}$' THEN
        RAISE EXCEPTION 'META_SECRET_INVALID' USING ERRCODE = '22023';
    END IF;
    SELECT vault.create_secret(p_secret, p_name, p_description) INTO v_secret_id;
    RETURN v_secret_id;
END; $$;

CREATE OR REPLACE FUNCTION ap.meta_read_secret(p_secret_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_secret text;
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE id = p_secret_id;
    IF v_secret IS NULL THEN RAISE EXCEPTION 'META_SECRET_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
    RETURN v_secret;
END; $$;

CREATE OR REPLACE FUNCTION ap.meta_delete_secret(p_secret_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_deleted boolean;
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    DELETE FROM vault.secrets WHERE id = p_secret_id RETURNING true INTO v_deleted;
    RETURN COALESCE(v_deleted, false);
END; $$;

CREATE OR REPLACE FUNCTION ap.consume_meta_oauth_state(p_state_hash text)
RETURNS ap.meta_oauth_states
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_state ap.meta_oauth_states%ROWTYPE;
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    UPDATE ap.meta_oauth_states
       SET consumed_at = now()
     WHERE state_hash = p_state_hash
       AND consumed_at IS NULL
       AND expires_at > now()
     RETURNING * INTO v_state;
    IF NOT FOUND THEN RAISE EXCEPTION 'META_OAUTH_STATE_INVALID' USING ERRCODE = '28000'; END IF;
    RETURN v_state;
END; $$;

-- Callback state is a ten-minute snapshot. Re-check the same operational
-- membership rules at completion so a removed or deactivated user cannot bind
-- a Meta account after their local access was revoked.
CREATE OR REPLACE FUNCTION ap.revalidate_meta_connection_actor(
    p_user_id uuid,
    p_cliente_id uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role text;
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    SELECT role INTO v_role FROM public.profissionais
      WHERE id = p_user_id AND ativo IS TRUE;
    IF v_role = 'super_admin' THEN
        RETURN EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND ativo IS TRUE);
    END IF;
    IF v_role <> 'admin' THEN RETURN false; END IF;
    RETURN EXISTS (
        SELECT 1 FROM public.cliente_profissionais membership
        WHERE membership.profissional_id = p_user_id
          AND membership.cliente_id = p_cliente_id AND membership.ativo IS TRUE
        UNION ALL
        SELECT 1
        FROM public.empresa_profissionais membership
        JOIN public.empresas tenant_empresa ON tenant_empresa.id = membership.empresa_id
        JOIN public.clientes client ON client.empresa_id = tenant_empresa.id
          OR client.empresa_id IN (
            SELECT empresa.id FROM public.empresas empresa WHERE empresa.tenant_id = tenant_empresa.id
          )
        JOIN public.empresas client_empresa ON client_empresa.id = client.empresa_id
        WHERE membership.profissional_id = p_user_id AND membership.ativo IS TRUE
          AND tenant_empresa.ativo IS TRUE AND tenant_empresa.empresa_tipo = 'tenant'
          AND client.id = p_cliente_id AND client.ativo IS TRUE AND client_empresa.ativo IS TRUE
    );
END; $$;

CREATE OR REPLACE FUNCTION ap.create_meta_oauth_state(
    p_state_hash text,
    p_user_id uuid,
    p_cliente_id uuid,
    p_redirect_target text
)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_flow_started_at timestamptz := clock_timestamp();
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF NOT ap.revalidate_meta_connection_actor(p_user_id, p_cliente_id) THEN
        RAISE EXCEPTION 'META_ACTOR_NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;
    INSERT INTO ap.meta_oauth_states (
      state_hash, user_id, cliente_id, redirect_target, flow_started_at, expires_at
    ) VALUES (
      p_state_hash, p_user_id, p_cliente_id, p_redirect_target,
      v_flow_started_at, v_flow_started_at + interval '10 minutes'
    );
    RETURN v_flow_started_at;
END; $$;

CREATE OR REPLACE FUNCTION ap.get_meta_connection_status()
RETURNS TABLE (
    connected boolean, status text, username text, page_name text,
    capabilities jsonb, granted_scopes text[], last_validated_at timestamptz,
    expires_at timestamptz, error_code text, selection_session_id uuid,
    selection_candidates jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cliente_id uuid := public.require_single_operational_cliente_id();
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ap.require_editorial_admin_access(v_cliente_id)) THEN
        RAISE EXCEPTION 'EDITORIAL_ADMIN_REQUIRED' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    WITH connection AS (
        SELECT c.* FROM ap.instagram_connections c
        WHERE c.cliente_id = v_cliente_id AND c.is_primary
        ORDER BY c.updated_at DESC LIMIT 1
    ), selection AS (
        SELECT s.* FROM ap.meta_oauth_selection_sessions s
        WHERE s.cliente_id = v_cliente_id AND s.user_id = auth.uid()
          AND s.consumed_at IS NULL AND s.expires_at > now()
        ORDER BY s.created_at DESC LIMIT 1
    )
    SELECT COALESCE(c.status = 'connected' AND (c.expires_at IS NULL OR c.expires_at > now()), false),
           CASE WHEN c.status = 'connected' AND c.expires_at IS NOT NULL AND c.expires_at <= now() THEN 'expired'
                ELSE COALESCE(c.status, 'disconnected') END,
           c.instagram_username, c.facebook_page_name,
           CASE WHEN c.status = 'connected' AND c.expires_at IS NOT NULL AND c.expires_at <= now() THEN '{}'::jsonb ELSE COALESCE(c.capabilities, '{}'::jsonb) END,
           CASE WHEN c.status = 'connected' AND c.expires_at IS NOT NULL AND c.expires_at <= now() THEN ARRAY[]::text[] ELSE COALESCE(c.granted_scopes, ARRAY[]::text[]) END,
           c.last_validated_at, c.expires_at,
           c.last_error_code, s.id,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', candidate.id, 'page_name', candidate.facebook_page_name, 'username', candidate.instagram_username))
                     FROM ap.meta_oauth_selection_candidates candidate WHERE candidate.session_id = s.id), '[]'::jsonb)
      FROM (SELECT 1) base
      LEFT JOIN connection c ON true
      LEFT JOIN selection s ON true;
END; $$;

REVOKE ALL ON FUNCTION ap.meta_create_secret(text, text, text), ap.meta_read_secret(uuid),
    ap.meta_delete_secret(uuid), ap.create_meta_oauth_state(text, uuid, uuid, text),
    ap.consume_meta_oauth_state(text), ap.revalidate_meta_connection_actor(uuid, uuid),
    ap.get_meta_connection_status(),
    ap.set_instagram_connection_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ap.meta_create_secret(text, text, text), ap.meta_read_secret(uuid),
    ap.meta_delete_secret(uuid), ap.create_meta_oauth_state(text, uuid, uuid, text),
    ap.consume_meta_oauth_state(text), ap.revalidate_meta_connection_actor(uuid, uuid)
    TO service_role;
GRANT EXECUTE ON FUNCTION ap.get_meta_connection_status() TO authenticated;

COMMENT ON TABLE ap.instagram_connections IS 'Tenant-scoped Meta Professional connection metadata. Tokens are only Vault references.';
COMMENT ON TABLE ap.meta_oauth_states IS 'Single-use hashed CSRF states for Meta OAuth. Raw state is never persisted.';
COMMENT ON TABLE ap.meta_oauth_selection_sessions IS 'Short-lived server-only Meta Page/Instagram selection state.';

-- Connection metadata and Vault references are one consistency boundary.  The
-- functions below are deliberately SECURITY DEFINER/service-role only: Edge
-- functions authenticate the actor first, then PostgreSQL serializes the
-- connection mutation and the Vault deletion in the same transaction.
ALTER TABLE ap.instagram_connections
    ADD COLUMN IF NOT EXISTS connection_version bigint NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS deauthorized_at timestamptz,
    ADD COLUMN IF NOT EXISTS secret_cleanup_pending boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS secret_cleanup_last_error text,
    ADD COLUMN IF NOT EXISTS secret_cleanup_last_attempt_at timestamptz;
ALTER TABLE ap.instagram_connections DROP CONSTRAINT IF EXISTS instagram_connections_status_check;
ALTER TABLE ap.instagram_connections
    ADD CONSTRAINT instagram_connections_status_check
    CHECK (status IN ('connected', 'disconnecting', 'disconnect_failed', 'disconnected', 'expired', 'revoked', 'error'));

CREATE OR REPLACE FUNCTION ap.meta_delete_secret_required(p_secret_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_secret_id IS NULL THEN RETURN; END IF;
    DELETE FROM vault.secrets WHERE id = p_secret_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'META_SECRET_DELETE_FAILED' USING ERRCODE = 'P0001';
    END IF;
END; $$;

CREATE OR REPLACE FUNCTION ap.meta_assert_secret_exists(p_secret_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_secret_id IS NULL OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE id = p_secret_id) THEN
        RAISE EXCEPTION 'META_SECRET_STORE_FAILED' USING ERRCODE = 'P0001';
    END IF;
END; $$;

CREATE OR REPLACE FUNCTION ap.meta_delete_connection_secret(
    p_secret_id uuid,
    p_connection_id uuid,
    p_allow_missing boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF p_secret_id IS NULL THEN RETURN; END IF;
    -- A malformed historical row must never make a tenant-local operation
    -- erase a secret still referenced by another live connection.
    IF EXISTS (
        SELECT 1 FROM ap.instagram_connections c
        WHERE (p_connection_id IS NULL OR c.id <> p_connection_id)
          AND c.status IN ('connected', 'disconnecting', 'disconnect_failed')
          AND (c.token_secret_ref = p_secret_id OR c.revocation_secret_ref = p_secret_id)
    ) THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM vault.secrets WHERE id = p_secret_id) THEN
      PERFORM ap.meta_delete_secret_required(p_secret_id);
    ELSIF NOT p_allow_missing THEN
      RAISE EXCEPTION 'META_SECRET_DELETE_FAILED' USING ERRCODE = 'P0001';
    END IF;
END; $$;

CREATE OR REPLACE FUNCTION ap.meta_lock_authorization(
    p_facebook_user_id text,
    p_flow_started_at timestamptz,
    p_expected_epoch bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_authorization ap.meta_authorizations%ROWTYPE;
BEGIN
    IF p_facebook_user_id IS NULL OR p_facebook_user_id = '' OR p_flow_started_at IS NULL THEN
      RAISE EXCEPTION 'META_AUTHORIZATION_INVALID' USING ERRCODE = '22023';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('ap.meta.authorization:' || p_facebook_user_id));
    INSERT INTO ap.meta_authorizations (facebook_user_id)
      VALUES (p_facebook_user_id) ON CONFLICT (facebook_user_id) DO NOTHING;
    SELECT * INTO v_authorization FROM ap.meta_authorizations
      WHERE facebook_user_id = p_facebook_user_id FOR UPDATE;
    IF v_authorization.last_deauthorized_at IS NOT NULL
       AND p_flow_started_at <= v_authorization.last_deauthorized_at THEN
      RAISE EXCEPTION 'META_AUTHORIZATION_REVOKED_DURING_FLOW' USING ERRCODE = '28000';
    END IF;
    IF p_expected_epoch IS NOT NULL AND p_expected_epoch <> v_authorization.authorization_epoch THEN
      RAISE EXCEPTION 'META_AUTHORIZATION_REVOKED_DURING_FLOW' USING ERRCODE = '28000';
    END IF;
    RETURN v_authorization.authorization_epoch;
END; $$;

-- Snapshot the current authorization epoch only after the callback has learned
-- the canonical Meta user. The temporal guard rejects an OAuth flow that began
-- before the most recent global deauthorization.
CREATE OR REPLACE FUNCTION ap.capture_meta_authorization_epoch(
    p_facebook_user_id text,
    p_flow_started_at timestamptz
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
      RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    RETURN ap.meta_lock_authorization(p_facebook_user_id, p_flow_started_at);
END; $$;

CREATE OR REPLACE FUNCTION ap.create_meta_oauth_selection_session(
    p_user_id uuid, p_cliente_id uuid, p_graph_api_version text,
    p_facebook_user_id text, p_user_access_token text, p_user_token_expires_at timestamptz,
    p_granted_scopes text[], p_flow_started_at timestamptz, p_authorization_epoch bigint,
    p_expires_at timestamptz, p_candidates jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session_id uuid; v_epoch bigint; v_candidate record;
DECLARE v_user_secret_ref uuid; v_page_secret_ref uuid;
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
      RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF NOT ap.revalidate_meta_connection_actor(p_user_id, p_cliente_id) THEN
      RAISE EXCEPTION 'META_ACTOR_NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;
    IF jsonb_typeof(p_candidates) <> 'array' OR jsonb_array_length(p_candidates) < 2 THEN
      RAISE EXCEPTION 'META_SELECTION_INVALID' USING ERRCODE = '22023';
    END IF;
    IF p_authorization_epoch IS NULL THEN
      RAISE EXCEPTION 'META_AUTHORIZATION_INVALID' USING ERRCODE = '22023';
    END IF;
    v_epoch := ap.meta_lock_authorization(
      p_facebook_user_id, p_flow_started_at, p_authorization_epoch
    );
    v_user_secret_ref := ap.meta_create_secret(
      p_user_access_token,
      'ap_meta_user_' || replace(gen_random_uuid()::text, '-', ''),
      'Temporary Meta OAuth user token owned by selection session'
    );
    INSERT INTO ap.meta_oauth_selection_sessions (
      user_id, cliente_id, graph_api_version, facebook_user_id, user_token_secret_ref,
      user_token_expires_at, granted_scopes, authorization_epoch, flow_started_at, expires_at
    ) VALUES (
      p_user_id, p_cliente_id, p_graph_api_version, p_facebook_user_id, v_user_secret_ref,
      p_user_token_expires_at, COALESCE(p_granted_scopes, ARRAY[]::text[]), v_epoch,
      p_flow_started_at, p_expires_at
    ) RETURNING id INTO v_session_id;
    FOR v_candidate IN SELECT * FROM jsonb_to_recordset(p_candidates) AS c(
      facebook_page_id text, facebook_page_name text, instagram_user_id text,
      instagram_username text, page_access_token text
    ) LOOP
      IF COALESCE(v_candidate.facebook_page_id, '') = ''
         OR COALESCE(v_candidate.instagram_user_id, '') = ''
         OR COALESCE(v_candidate.instagram_username, '') = ''
         OR COALESCE(v_candidate.page_access_token, '') = '' THEN
        RAISE EXCEPTION 'META_SELECTION_INVALID' USING ERRCODE = '22023';
      END IF;
      v_page_secret_ref := ap.meta_create_secret(
        v_candidate.page_access_token,
        'ap_meta_page_' || replace(gen_random_uuid()::text, '-', ''),
        'Temporary Meta Page access token owned by selection session'
      );
      INSERT INTO ap.meta_oauth_selection_candidates (
        session_id, facebook_page_id, facebook_page_name, instagram_user_id,
        instagram_username, page_token_secret_ref
      ) VALUES (
        v_session_id, v_candidate.facebook_page_id, v_candidate.facebook_page_name,
        v_candidate.instagram_user_id, v_candidate.instagram_username, v_page_secret_ref
      );
    END LOOP;
    RETURN v_session_id;
END; $$;

CREATE OR REPLACE FUNCTION ap.reconnect_meta_connection(
    p_cliente_id uuid, p_actor_user_id uuid,
    p_facebook_user_id text, p_instagram_user_id text, p_instagram_username text,
    p_facebook_page_id text, p_facebook_page_name text,
    p_page_secret_ref uuid, p_user_secret_ref uuid,
    p_granted_scopes text[], p_capabilities jsonb,
    p_graph_api_version text, p_expires_at timestamptz,
    p_flow_started_at timestamptz, p_authorization_epoch bigint
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_previous ap.instagram_connections%ROWTYPE; v_primary_id uuid;
DECLARE v_connection_id uuid; v_version bigint; v_is_primary boolean; v_epoch bigint;
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF NOT ap.revalidate_meta_connection_actor(p_actor_user_id, p_cliente_id) THEN
        RAISE EXCEPTION 'META_ACTOR_NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;
    IF p_instagram_user_id IS NULL OR p_instagram_user_id = '' THEN
        RAISE EXCEPTION 'META_CONNECTION_INVALID' USING ERRCODE = '22023';
    END IF;
    IF p_authorization_epoch IS NULL THEN
        RAISE EXCEPTION 'META_AUTHORIZATION_INVALID' USING ERRCODE = '22023';
    END IF;
    v_epoch := ap.meta_lock_authorization(
      p_facebook_user_id, p_flow_started_at, p_authorization_epoch
    );
    PERFORM pg_advisory_xact_lock(hashtext('ap.meta.connection:' || p_cliente_id::text || ':meta:' || p_instagram_user_id));
    PERFORM pg_advisory_xact_lock(hashtext('ap.meta.primary:' || p_cliente_id::text));
    PERFORM ap.meta_assert_secret_exists(p_page_secret_ref);
    PERFORM ap.meta_assert_secret_exists(p_user_secret_ref);
    SELECT * INTO v_previous FROM ap.instagram_connections
      WHERE cliente_id = p_cliente_id AND provider = 'meta' AND instagram_user_id = p_instagram_user_id
      FOR UPDATE;
    SELECT id INTO v_primary_id FROM ap.instagram_connections
      WHERE cliente_id = p_cliente_id AND provider = 'meta' AND status = 'connected' AND is_primary
      FOR UPDATE;
    v_is_primary := v_primary_id IS NULL OR (v_previous.id IS NOT NULL AND v_primary_id = v_previous.id);
    IF v_primary_id IS NULL THEN
      UPDATE ap.instagram_connections SET is_primary = false
      WHERE cliente_id = p_cliente_id AND provider = 'meta';
    END IF;
    IF v_previous.id IS NOT NULL THEN
      IF v_previous.token_secret_ref IS DISTINCT FROM p_page_secret_ref
         AND v_previous.token_secret_ref IS DISTINCT FROM p_user_secret_ref THEN
        PERFORM ap.meta_delete_connection_secret(v_previous.token_secret_ref, v_previous.id);
      END IF;
      IF v_previous.revocation_secret_ref IS DISTINCT FROM p_page_secret_ref
         AND v_previous.revocation_secret_ref IS DISTINCT FROM p_user_secret_ref THEN
        PERFORM ap.meta_delete_connection_secret(v_previous.revocation_secret_ref, v_previous.id);
      END IF;
    END IF;
    INSERT INTO ap.instagram_connections (
      cliente_id, provider, status, is_primary, facebook_user_id, instagram_user_id, instagram_username,
      facebook_page_id, facebook_page_name, token_secret_ref, revocation_secret_ref, granted_scopes,
      capabilities, graph_api_version, connected_by_user_id, connected_at, last_validated_at, expires_at,
      last_error_code, last_error_at, disconnected_at, deauthorized_at, secret_cleanup_pending,
      secret_cleanup_last_error, secret_cleanup_last_attempt_at
    ) VALUES (
      p_cliente_id, 'meta', 'connected', v_is_primary, p_facebook_user_id, p_instagram_user_id,
      p_instagram_username, p_facebook_page_id, p_facebook_page_name, p_page_secret_ref, p_user_secret_ref,
      COALESCE(p_granted_scopes, ARRAY[]::text[]), COALESCE(p_capabilities, '{}'::jsonb), p_graph_api_version,
      p_actor_user_id, now(), now(), p_expires_at, NULL, NULL, NULL, NULL, false, NULL, NULL
    ) ON CONFLICT (cliente_id, provider, instagram_user_id) DO UPDATE SET
      status = 'connected', is_primary = EXCLUDED.is_primary, facebook_user_id = EXCLUDED.facebook_user_id,
      instagram_username = EXCLUDED.instagram_username, facebook_page_id = EXCLUDED.facebook_page_id,
      facebook_page_name = EXCLUDED.facebook_page_name, token_secret_ref = EXCLUDED.token_secret_ref,
      revocation_secret_ref = EXCLUDED.revocation_secret_ref, granted_scopes = EXCLUDED.granted_scopes,
      capabilities = EXCLUDED.capabilities, graph_api_version = EXCLUDED.graph_api_version,
      connected_by_user_id = EXCLUDED.connected_by_user_id, connected_at = EXCLUDED.connected_at,
      last_validated_at = EXCLUDED.last_validated_at, expires_at = EXCLUDED.expires_at,
      last_error_code = NULL, last_error_at = NULL, disconnected_at = NULL, deauthorized_at = NULL,
      secret_cleanup_pending = false, secret_cleanup_last_error = NULL, secret_cleanup_last_attempt_at = NULL,
      connection_version = ap.instagram_connections.connection_version + 1
    RETURNING id, connection_version INTO v_connection_id, v_version;
    RETURN jsonb_build_object('connection_id', v_connection_id, 'connection_version', v_version);
END; $$;

-- Single-account OAuth completion is one PostgreSQL/Vault transaction. Raw
-- tokens are accepted only from service_role and are persisted exclusively by
-- Vault; the result contains connection metadata only.
CREATE OR REPLACE FUNCTION ap.complete_meta_oauth_connection(
    p_user_id uuid, p_cliente_id uuid, p_graph_api_version text,
    p_facebook_user_id text, p_user_access_token text, p_user_token_expires_at timestamptz,
    p_granted_scopes text[], p_flow_started_at timestamptz, p_authorization_epoch bigint,
    p_page jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_epoch bigint; v_user_secret_ref uuid; v_page_secret_ref uuid;
DECLARE v_result jsonb;
DECLARE v_page_id text := p_page ->> 'facebook_page_id';
DECLARE v_page_name text := p_page ->> 'facebook_page_name';
DECLARE v_instagram_user_id text := p_page ->> 'instagram_user_id';
DECLARE v_instagram_username text := p_page ->> 'instagram_username';
DECLARE v_page_access_token text := p_page ->> 'page_access_token';
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
      RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF NOT ap.revalidate_meta_connection_actor(p_user_id, p_cliente_id) THEN
      RAISE EXCEPTION 'META_ACTOR_NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;
    IF p_authorization_epoch IS NULL OR COALESCE(v_page_id, '') = ''
       OR COALESCE(v_page_name, '') = '' OR COALESCE(v_instagram_user_id, '') = ''
       OR COALESCE(v_instagram_username, '') = '' OR COALESCE(v_page_access_token, '') = '' THEN
      RAISE EXCEPTION 'META_CONNECTION_INVALID' USING ERRCODE = '22023';
    END IF;
    v_epoch := ap.meta_lock_authorization(
      p_facebook_user_id, p_flow_started_at, p_authorization_epoch
    );
    v_user_secret_ref := ap.meta_create_secret(
      p_user_access_token,
      'ap_meta_user_' || replace(gen_random_uuid()::text, '-', ''),
      'Meta OAuth user token owned by active connection'
    );
    v_page_secret_ref := ap.meta_create_secret(
      v_page_access_token,
      'ap_meta_page_' || replace(gen_random_uuid()::text, '-', ''),
      'Meta Page access token owned by active connection'
    );
    SELECT ap.reconnect_meta_connection(
      p_cliente_id, p_user_id, p_facebook_user_id, v_instagram_user_id,
      v_instagram_username, v_page_id, v_page_name, v_page_secret_ref,
      v_user_secret_ref, COALESCE(p_granted_scopes, ARRAY[]::text[]),
      jsonb_build_object(
        'radar_read', COALESCE(p_granted_scopes, ARRAY[]::text[]) @> ARRAY['pages_show_list','pages_read_engagement','instagram_basic']::text[],
        'publishing', COALESCE(p_granted_scopes, ARRAY[]::text[]) @> ARRAY['instagram_content_publish']::text[],
        'comments', COALESCE(p_granted_scopes, ARRAY[]::text[]) @> ARRAY['instagram_manage_comments']::text[],
        'messages', COALESCE(p_granted_scopes, ARRAY[]::text[]) @> ARRAY['instagram_manage_messages']::text[]
      ), p_graph_api_version, p_user_token_expires_at, p_flow_started_at, v_epoch
    ) INTO v_result;
    RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION ap.disconnect_meta_connection(p_cliente_id uuid, p_actor_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_connection ap.instagram_connections%ROWTYPE;
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF NOT ap.revalidate_meta_connection_actor(p_actor_user_id, p_cliente_id) THEN
        RAISE EXCEPTION 'META_ACTOR_NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('ap.meta.primary:' || p_cliente_id::text));
    SELECT * INTO v_connection FROM ap.instagram_connections
      WHERE cliente_id = p_cliente_id AND provider = 'meta' AND is_primary
      ORDER BY updated_at DESC LIMIT 1 FOR UPDATE;
    IF NOT FOUND OR v_connection.status = 'disconnected' THEN
      RETURN jsonb_build_object('disconnected', true, 'idempotent', true);
    END IF;
    PERFORM ap.meta_delete_connection_secret(v_connection.token_secret_ref, v_connection.id);
    PERFORM ap.meta_delete_connection_secret(v_connection.revocation_secret_ref, v_connection.id);
    UPDATE ap.instagram_connections SET status = 'disconnected', is_primary = false,
      token_secret_ref = NULL, revocation_secret_ref = NULL, capabilities = '{}'::jsonb,
      granted_scopes = ARRAY[]::text[], disconnected_at = now(), last_error_code = NULL, last_error_at = NULL,
      secret_cleanup_pending = false, secret_cleanup_last_error = NULL, secret_cleanup_last_attempt_at = NULL,
      connection_version = connection_version + 1
      WHERE id = v_connection.id;
    RETURN jsonb_build_object('disconnected', true, 'idempotent', false);
END; $$;

CREATE OR REPLACE FUNCTION ap.mark_meta_connections_revoked(p_facebook_user_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ids jsonb; v_deauthorized_at timestamptz;
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    -- The same lock is taken by reconnect/selection before they can write a
    -- connected row. The epoch rejects OAuth material that predates this event.
    PERFORM pg_advisory_xact_lock(hashtext('ap.meta.authorization:' || p_facebook_user_id));
    v_deauthorized_at := clock_timestamp();
    INSERT INTO ap.meta_authorizations (facebook_user_id, authorization_epoch, last_deauthorized_at)
      VALUES (p_facebook_user_id, 1, v_deauthorized_at)
      ON CONFLICT (facebook_user_id) DO UPDATE SET
        authorization_epoch = ap.meta_authorizations.authorization_epoch + 1,
        last_deauthorized_at = GREATEST(
          COALESCE(ap.meta_authorizations.last_deauthorized_at, '-infinity'::timestamptz),
          v_deauthorized_at
        ),
        updated_at = v_deauthorized_at;
    WITH locked AS (
      SELECT id FROM ap.instagram_connections WHERE provider = 'meta' AND facebook_user_id = p_facebook_user_id FOR UPDATE
    ), changed AS (
      UPDATE ap.instagram_connections c SET status = 'revoked', is_primary = false, capabilities = '{}'::jsonb,
        granted_scopes = ARRAY[]::text[], deauthorized_at = v_deauthorized_at, last_error_code = 'META_ACCESS_REVOKED',
        last_error_at = v_deauthorized_at, secret_cleanup_pending = (c.token_secret_ref IS NOT NULL OR c.revocation_secret_ref IS NOT NULL),
        secret_cleanup_last_error = NULL, secret_cleanup_last_attempt_at = NULL,
        connection_version = c.connection_version + 1
      FROM locked WHERE c.id = locked.id RETURNING c.id
    ) SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_ids FROM changed;
    RETURN v_ids;
END; $$;

CREATE OR REPLACE FUNCTION ap.cleanup_revoked_meta_connection(p_connection_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_connection ap.instagram_connections%ROWTYPE;
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_connection FROM ap.instagram_connections WHERE id = p_connection_id FOR UPDATE;
    IF NOT FOUND THEN RETURN true; END IF;
    IF v_connection.status NOT IN ('revoked', 'expired') THEN
      RAISE EXCEPTION 'META_CLEANUP_CONNECTION_NOT_REVOKED' USING ERRCODE = '22023';
    END IF;
    PERFORM ap.meta_delete_connection_secret(v_connection.token_secret_ref, v_connection.id, true);
    PERFORM ap.meta_delete_connection_secret(v_connection.revocation_secret_ref, v_connection.id, true);
    UPDATE ap.instagram_connections SET token_secret_ref = NULL, revocation_secret_ref = NULL,
      secret_cleanup_pending = false, secret_cleanup_last_error = NULL, secret_cleanup_last_attempt_at = now(),
      connection_version = connection_version + 1 WHERE id = v_connection.id;
    RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION ap.record_meta_secret_cleanup_failure(p_connection_id uuid, p_error_code text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    UPDATE ap.instagram_connections SET secret_cleanup_pending = true,
      secret_cleanup_last_error = 'META_SECRET_DELETE_FAILED', secret_cleanup_last_attempt_at = now(),
      connection_version = connection_version + 1
    WHERE id = p_connection_id AND status IN ('revoked', 'expired');
END; $$;

CREATE OR REPLACE FUNCTION ap.cleanup_expired_meta_oauth_sessions(p_limit integer DEFAULT 20)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session ap.meta_oauth_selection_sessions%ROWTYPE; v_candidate record; v_count integer := 0;
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    FOR v_session IN SELECT * FROM ap.meta_oauth_selection_sessions
      WHERE consumed_at IS NULL AND expires_at <= now() ORDER BY expires_at LIMIT GREATEST(1, LEAST(p_limit, 50)) FOR UPDATE SKIP LOCKED
    LOOP
      FOR v_candidate IN SELECT page_token_secret_ref FROM ap.meta_oauth_selection_candidates WHERE session_id = v_session.id FOR UPDATE LOOP
        PERFORM ap.meta_delete_connection_secret(v_candidate.page_token_secret_ref, NULL, true);
      END LOOP;
      PERFORM ap.meta_delete_connection_secret(v_session.user_token_secret_ref, NULL, true);
      DELETE FROM ap.meta_oauth_selection_sessions WHERE id = v_session.id AND consumed_at IS NULL;
      v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END; $$;

-- Selection is single-use only after both the connection transfer and the
-- disposal of every non-selected temporary Page token have committed.
CREATE OR REPLACE FUNCTION ap.select_meta_oauth_candidate(
    p_candidate_id uuid,
    p_actor_user_id uuid,
    p_cliente_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session ap.meta_oauth_selection_sessions%ROWTYPE;
DECLARE v_candidate ap.meta_oauth_selection_candidates%ROWTYPE;
DECLARE v_other record; v_result jsonb;
BEGIN
    IF session_user <> 'postgres' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
    END IF;
    SELECT s.* INTO v_session FROM ap.meta_oauth_selection_candidates c
      JOIN ap.meta_oauth_selection_sessions s ON s.id = c.session_id
      WHERE c.id = p_candidate_id FOR UPDATE OF s;
    IF NOT FOUND THEN RAISE EXCEPTION 'META_SELECTION_INVALID' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_candidate FROM ap.meta_oauth_selection_candidates
      WHERE id = p_candidate_id AND session_id = v_session.id FOR UPDATE;
    IF v_session.user_id <> p_actor_user_id OR v_session.cliente_id <> p_cliente_id
       OR NOT ap.revalidate_meta_connection_actor(p_actor_user_id, p_cliente_id) THEN
      RAISE EXCEPTION 'META_SELECTION_INVALID' USING ERRCODE = '42501';
    END IF;
    IF v_session.consumed_at IS NOT NULL THEN
      RAISE EXCEPTION 'META_SELECTION_ALREADY_CONSUMED' USING ERRCODE = '28000';
    END IF;
    IF v_session.expires_at <= now() THEN
      RAISE EXCEPTION 'META_SELECTION_EXPIRED' USING ERRCODE = '28000';
    END IF;
    SELECT ap.reconnect_meta_connection(
      p_cliente_id, p_actor_user_id, v_session.facebook_user_id, v_candidate.instagram_user_id,
      v_candidate.instagram_username, v_candidate.facebook_page_id, v_candidate.facebook_page_name,
      v_candidate.page_token_secret_ref, v_session.user_token_secret_ref, v_session.granted_scopes,
      jsonb_build_object(
        'radar_read', v_session.granted_scopes @> ARRAY['pages_show_list','pages_read_engagement','instagram_basic']::text[],
        'publishing', v_session.granted_scopes @> ARRAY['instagram_content_publish']::text[],
        'comments', v_session.granted_scopes @> ARRAY['instagram_manage_comments']::text[],
        'messages', v_session.granted_scopes @> ARRAY['instagram_manage_messages']::text[]
      ), v_session.graph_api_version, v_session.user_token_expires_at,
      v_session.flow_started_at, v_session.authorization_epoch
    ) INTO v_result;
    FOR v_other IN SELECT id, page_token_secret_ref FROM ap.meta_oauth_selection_candidates
      WHERE session_id = v_session.id AND id <> v_candidate.id FOR UPDATE
    LOOP
      IF v_other.page_token_secret_ref IS DISTINCT FROM v_candidate.page_token_secret_ref THEN
        PERFORM ap.meta_delete_secret_required(v_other.page_token_secret_ref);
      END IF;
    END LOOP;
    -- Retain only the selected candidate as a replay tombstone; status queries
    -- expose candidates solely for unconsumed sessions, while a duplicate POST
    -- can now deterministically return META_SELECTION_ALREADY_CONSUMED.
    DELETE FROM ap.meta_oauth_selection_candidates WHERE session_id = v_session.id AND id <> v_candidate.id;
    UPDATE ap.meta_oauth_selection_sessions SET consumed_at = now()
      WHERE id = v_session.id AND consumed_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'META_SELECTION_ALREADY_CONSUMED' USING ERRCODE = '28000'; END IF;
    RETURN v_result;
END; $$;

REVOKE ALL ON FUNCTION ap.meta_delete_secret_required(uuid), ap.meta_assert_secret_exists(uuid),
  ap.meta_delete_connection_secret(uuid, uuid, boolean), ap.meta_lock_authorization(text, timestamptz, bigint),
  ap.capture_meta_authorization_epoch(text, timestamptz),
  ap.create_meta_oauth_selection_session(uuid, uuid, text, text, text, timestamptz, text[], timestamptz, bigint, timestamptz, jsonb),
  ap.reconnect_meta_connection(uuid, uuid, text, text, text, text, text, uuid, uuid, text[], jsonb, text, timestamptz, timestamptz, bigint),
  ap.complete_meta_oauth_connection(uuid, uuid, text, text, text, timestamptz, text[], timestamptz, bigint, jsonb),
  ap.select_meta_oauth_candidate(uuid, uuid, uuid),
  ap.disconnect_meta_connection(uuid, uuid), ap.mark_meta_connections_revoked(text), ap.cleanup_revoked_meta_connection(uuid),
  ap.record_meta_secret_cleanup_failure(uuid, text), ap.cleanup_expired_meta_oauth_sessions(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ap.capture_meta_authorization_epoch(text, timestamptz),
  ap.create_meta_oauth_selection_session(uuid, uuid, text, text, text, timestamptz, text[], timestamptz, bigint, timestamptz, jsonb),
  ap.reconnect_meta_connection(uuid, uuid, text, text, text, text, text, uuid, uuid, text[], jsonb, text, timestamptz, timestamptz, bigint),
  ap.complete_meta_oauth_connection(uuid, uuid, text, text, text, timestamptz, text[], timestamptz, bigint, jsonb),
  ap.select_meta_oauth_candidate(uuid, uuid, uuid),
  ap.disconnect_meta_connection(uuid, uuid), ap.mark_meta_connections_revoked(text), ap.cleanup_revoked_meta_connection(uuid),
  ap.record_meta_secret_cleanup_failure(uuid, text), ap.cleanup_expired_meta_oauth_sessions(integer) TO service_role;
GRANT USAGE ON SCHEMA ap TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
