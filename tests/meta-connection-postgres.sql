\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"role":"service_role"}'::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-4000-8000-000000000011'::uuid $$;
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text, description text);
CREATE FUNCTION vault.create_secret(p_secret text, p_name text DEFAULT NULL, p_description text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE result uuid; BEGIN
  IF p_secret = '__FAIL_VAULT_CREATE__' THEN
    RAISE EXCEPTION 'injected vault create failure' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO vault.secrets(name, secret, description) VALUES (p_name, p_secret, p_description) RETURNING id INTO result;
  RETURN result;
END $$;
CREATE VIEW vault.decrypted_secrets AS SELECT id, secret AS decrypted_secret FROM vault.secrets;

CREATE TABLE public.clientes (id uuid PRIMARY KEY, ativo boolean NOT NULL DEFAULT true, empresa_id uuid);
CREATE TABLE public.profissionais (id uuid PRIMARY KEY, ativo boolean NOT NULL DEFAULT true, role text NOT NULL, nome text, email text);
CREATE TABLE public.cliente_profissionais (profissional_id uuid, cliente_id uuid, ativo boolean NOT NULL DEFAULT true);
CREATE TABLE public.empresas (id uuid PRIMARY KEY, tenant_id uuid, ativo boolean NOT NULL DEFAULT true, empresa_tipo text);
CREATE TABLE public.empresa_profissionais (profissional_id uuid, empresa_id uuid, ativo boolean NOT NULL DEFAULT true);
CREATE FUNCTION public.require_single_operational_cliente_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-4000-8000-000000000001'::uuid $$;
CREATE SCHEMA ap;
CREATE FUNCTION ap.require_editorial_admin_access(p_cliente_id uuid)
RETURNS TABLE (user_id uuid, role text, display_name text) LANGUAGE sql STABLE AS $$
  SELECT '00000000-0000-4000-8000-000000000011'::uuid, 'admin'::text, 'test'::text
$$;

\i /workspace/supabase/migrations/20260921160000_meta_instagram_connection_infrastructure.sql

INSERT INTO public.clientes(id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');
INSERT INTO public.profissionais(id, role) VALUES
  ('00000000-0000-4000-8000-000000000011', 'admin');
INSERT INTO public.cliente_profissionais(profissional_id, cliente_id) VALUES
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000002');

-- OAuth start receives one immutable database-clock timestamp and derives its
-- expiry from that same value.
SELECT ap.create_meta_oauth_state(
  repeat('a', 64), '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000001', '/admin/settings/integrations/meta/callback'
);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ap.meta_oauth_states
    WHERE state_hash = repeat('a', 64)
      AND flow_started_at IS NOT NULL
      AND expires_at = flow_started_at + interval '10 minutes'
  ) THEN RAISE EXCEPTION 'OAuth state flow_started_at contract failed'; END IF;
END $$;

-- Graph-version constraints are executed by PostgreSQL, not inferred from text inspection.
INSERT INTO ap.instagram_connections (cliente_id, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, connected_at, graph_api_version)
VALUES ('00000000-0000-4000-8000-000000000001', 'ig-version-1', 'version1', 'page-version-1', gen_random_uuid(), now(), 'v23.0'),
       ('00000000-0000-4000-8000-000000000001', 'ig-version-2', 'version2', 'page-version-2', gen_random_uuid(), now(), 'v24.0'),
       ('00000000-0000-4000-8000-000000000001', 'ig-version-3', 'version3', 'page-version-3', gen_random_uuid(), now(), 'v100.12');
DO $$
DECLARE invalid_version text;
BEGIN
  FOREACH invalid_version IN ARRAY ARRAY['23.0', 'v23', 'latest', 'v23x0', E'v23\\0'] LOOP
    BEGIN
      INSERT INTO ap.instagram_connections (cliente_id, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, connected_at, graph_api_version)
      VALUES ('00000000-0000-4000-8000-000000000001', 'invalid-' || replace(invalid_version, E'\\', 'x'), 'invalid', 'invalid', gen_random_uuid(), now(), invalid_version);
      RAISE EXCEPTION 'invalid Graph version accepted: %', invalid_version;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
END $$;

-- Reconnect uses the same logical row before and after a disconnected state.
INSERT INTO ap.instagram_connections (cliente_id, provider, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, connected_at, graph_api_version, status)
VALUES ('00000000-0000-4000-8000-000000000002', 'meta', 'ig-reconnect', 'reconnect', 'page-reconnect', gen_random_uuid(), now(), 'v23.0', 'connected')
ON CONFLICT (cliente_id, provider, instagram_user_id) DO UPDATE SET instagram_username = EXCLUDED.instagram_username;
UPDATE ap.instagram_connections SET status = 'disconnected', token_secret_ref = NULL WHERE cliente_id = '00000000-0000-4000-8000-000000000002' AND instagram_user_id = 'ig-reconnect';
INSERT INTO ap.instagram_connections (cliente_id, provider, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, connected_at, graph_api_version, status)
VALUES ('00000000-0000-4000-8000-000000000002', 'meta', 'ig-reconnect', 'reconnected', 'page-reconnect', gen_random_uuid(), now(), 'v23.0', 'connected')
ON CONFLICT (cliente_id, provider, instagram_user_id) DO UPDATE SET status = EXCLUDED.status, token_secret_ref = EXCLUDED.token_secret_ref, connected_at = EXCLUDED.connected_at;
DO $$ BEGIN
  IF (SELECT count(*) FROM ap.instagram_connections WHERE cliente_id = '00000000-0000-4000-8000-000000000002' AND provider = 'meta' AND instagram_user_id = 'ig-reconnect') <> 1 THEN
    RAISE EXCEPTION 'reconnect created duplicate connection';
  END IF;
END $$;

-- Transactional reconnect/disconnect: old and new Vault refs never coexist in
-- a committed connection, and disconnect leaves no usable connection behind.
INSERT INTO public.clientes(id) VALUES ('00000000-0000-4000-8000-000000000003');
INSERT INTO public.cliente_profissionais(profissional_id, cliente_id) VALUES
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000003');
DO $$
DECLARE old_page uuid := vault.create_secret('old-page', 'tx-old-page');
DECLARE old_user uuid := vault.create_secret('old-user', 'tx-old-user');
DECLARE new_page uuid := vault.create_secret('new-page', 'tx-new-page');
DECLARE new_user uuid := vault.create_secret('new-user', 'tx-new-user');
BEGIN
  INSERT INTO ap.instagram_connections(cliente_id, provider, status, is_primary, facebook_user_id, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, revocation_secret_ref, connected_at, graph_api_version)
  VALUES ('00000000-0000-4000-8000-000000000003', 'meta', 'connected', true, 'fb-tx', 'ig-tx', 'old', 'page-old', old_page, old_user, now(), 'v23.0');
  PERFORM ap.reconnect_meta_connection('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000011', 'fb-tx', 'ig-tx', 'new', 'page-new', 'New', new_page, new_user, ARRAY['instagram_basic'], '{}'::jsonb, 'v23.0', now() + interval '1 hour', clock_timestamp(), 0);
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE id IN (old_page, old_user))
     OR NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE cliente_id = '00000000-0000-4000-8000-000000000003' AND instagram_user_id = 'ig-tx' AND token_secret_ref = new_page AND revocation_secret_ref = new_user AND status = 'connected') THEN
    RAISE EXCEPTION 'transactional reconnect did not swap refs atomically';
  END IF;
  PERFORM ap.disconnect_meta_connection('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000011');
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE id IN (new_page, new_user))
     OR NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE cliente_id = '00000000-0000-4000-8000-000000000003' AND instagram_user_id = 'ig-tx' AND status = 'disconnected' AND token_secret_ref IS NULL AND revocation_secret_ref IS NULL) THEN
    RAISE EXCEPTION 'transactional disconnect left a live secret or connection';
  END IF;
END $$;

-- A Vault deletion failure rolls back the connection transition. The Edge can
-- safely remove the still-temporary new refs because no committed row owns them.
DO $$
DECLARE missing_old uuid := gen_random_uuid();
DECLARE new_page uuid := vault.create_secret('retry-page', 'tx-retry-page');
DECLARE new_user uuid := vault.create_secret('retry-user', 'tx-retry-user');
BEGIN
  INSERT INTO ap.instagram_connections(cliente_id, provider, status, is_primary, facebook_user_id, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, revocation_secret_ref, connected_at, graph_api_version)
  VALUES ('00000000-0000-4000-8000-000000000003', 'meta', 'connected', true, 'fb-fail', 'ig-retry', 'old', 'page-old', missing_old, gen_random_uuid(), now(), 'v23.0');
  BEGIN
    PERFORM ap.reconnect_meta_connection('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000011', 'fb-fail', 'ig-retry', 'new', 'page-new', 'New', new_page, new_user, ARRAY[]::text[], '{}'::jsonb, 'v23.0', NULL, clock_timestamp(), 0);
    RAISE EXCEPTION 'reconnect accepted a missing old Vault ref';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE cliente_id = '00000000-0000-4000-8000-000000000003' AND instagram_user_id = 'ig-retry' AND token_secret_ref = missing_old AND status = 'connected')
     OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE id IN (new_page, new_user)) THEN
    RAISE EXCEPTION 'reconnect failure was not rollback-safe';
  END IF;
  BEGIN
    PERFORM ap.disconnect_meta_connection('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000011');
    RAISE EXCEPTION 'disconnect accepted a missing Vault ref';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
END $$;

-- Meta deauthorization commits the unusable state before best-effort cleanup.
DO $$
DECLARE missing_secret uuid := gen_random_uuid();
DECLARE revoked_ids jsonb;
DECLARE revoked_id uuid;
BEGIN
  INSERT INTO ap.instagram_connections(cliente_id, provider, status, facebook_user_id, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, connected_at, graph_api_version)
  VALUES ('00000000-0000-4000-8000-000000000003', 'meta', 'connected', 'fb-revoked', 'ig-revoked', 'revoked', 'page-revoked', missing_secret, now(), 'v23.0');
  SELECT ap.mark_meta_connections_revoked('fb-revoked') INTO revoked_ids;
  SELECT (value #>> '{}')::uuid INTO revoked_id FROM jsonb_array_elements(revoked_ids) LIMIT 1;
  IF NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE id = revoked_id AND status = 'revoked' AND capabilities = '{}'::jsonb AND secret_cleanup_pending) THEN
    RAISE EXCEPTION 'deauthorize did not fail closed before cleanup';
  END IF;
  PERFORM ap.cleanup_revoked_meta_connection(revoked_id);
  IF NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE id = revoked_id AND status = 'revoked'
      AND token_secret_ref IS NULL AND secret_cleanup_pending IS FALSE) THEN
    RAISE EXCEPTION 'revoked cleanup did not converge for an already-removed secret';
  END IF;
END $$;

-- Failure while deleting a non-selected temporary secret rolls back the whole
-- selection: it remains retryable and no connection adopts the selected ref.
DO $$
DECLARE sid uuid := gen_random_uuid();
DECLARE chosen uuid := vault.create_secret('selection-chosen', 'selection-chosen');
BEGIN
  INSERT INTO ap.meta_oauth_selection_sessions(id, user_id, cliente_id, graph_api_version, facebook_user_id, user_token_secret_ref, expires_at, granted_scopes)
  VALUES (sid, '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000003', 'v23.0', 'fb-selection-fail', vault.create_secret('selection-user', 'selection-user'), now() + interval '5 minutes', ARRAY[]::text[]);
  INSERT INTO ap.meta_oauth_selection_candidates(id, session_id, facebook_page_id, facebook_page_name, instagram_user_id, instagram_username, page_token_secret_ref)
  VALUES (gen_random_uuid(), sid, 'page-good', 'Good', 'ig-selection-fail', 'good', chosen),
         (gen_random_uuid(), sid, 'page-bad', 'Bad', 'ig-selection-bad', 'bad', gen_random_uuid());
  BEGIN
    PERFORM ap.select_meta_oauth_candidate(
      (SELECT id FROM ap.meta_oauth_selection_candidates WHERE session_id = sid AND instagram_user_id = 'ig-selection-fail'),
      '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'selection accepted missing temporary secret';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM ap.meta_oauth_selection_sessions WHERE id = sid AND consumed_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM ap.instagram_connections WHERE cliente_id = '00000000-0000-4000-8000-000000000003' AND instagram_user_id = 'ig-selection-fail')
     OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE id = chosen) THEN
    RAISE EXCEPTION 'selection cleanup rollback unsafe';
  END IF;
END $$;

-- The selection RPC owns the persistence and consumption in one transaction.
INSERT INTO ap.meta_oauth_selection_sessions(id, user_id, cliente_id, graph_api_version, facebook_user_id, user_token_secret_ref, expires_at, granted_scopes)
VALUES ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'v23.0', 'fb-shared', vault.create_secret('user-select', 'user-select'), now() + interval '10 minutes', ARRAY['pages_show_list','pages_read_engagement','instagram_basic']);
INSERT INTO ap.meta_oauth_selection_candidates(id, session_id, facebook_page_id, facebook_page_name, instagram_user_id, instagram_username, page_token_secret_ref)
VALUES ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 'page-select', 'Select', 'ig-select', 'select', vault.create_secret('page-select', 'page-select'));
SELECT ap.select_meta_oauth_candidate('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001');
DO $$ BEGIN
  PERFORM ap.select_meta_oauth_candidate('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'selection replay accepted';
EXCEPTION WHEN sqlstate '28000' THEN NULL;
END $$;
UPDATE ap.instagram_connections SET is_primary = false
WHERE cliente_id = '00000000-0000-4000-8000-000000000001' AND instagram_user_id = 'ig-select';

-- Tenant A local cleanup leaves tenant B's same Facebook user connection untouched.
INSERT INTO ap.instagram_connections (cliente_id, provider, status, is_primary, facebook_user_id, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, connected_at, graph_api_version)
VALUES
('00000000-0000-4000-8000-000000000001', 'meta', 'connected', true, 'fb-shared', 'ig-a', 'a', 'page-a', gen_random_uuid(), now(), 'v23.0'),
('00000000-0000-4000-8000-000000000002', 'meta', 'connected', true, 'fb-shared', 'ig-b', 'b', 'page-b', gen_random_uuid(), now(), 'v23.0');
UPDATE ap.instagram_connections SET status = 'disconnected', is_primary = false, token_secret_ref = NULL
WHERE cliente_id = '00000000-0000-4000-8000-000000000001' AND instagram_user_id = 'ig-a';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE cliente_id = '00000000-0000-4000-8000-000000000002' AND instagram_user_id = 'ig-b' AND status = 'connected' AND token_secret_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'tenant B connection was affected by tenant A disconnect';
  END IF;
END $$;

INSERT INTO ap.instagram_connections (cliente_id, provider, status, is_primary, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, connected_at, expires_at, graph_api_version)
VALUES ('00000000-0000-4000-8000-000000000001', 'meta', 'connected', true, 'ig-expired', 'expired', 'page-expired', gen_random_uuid(), now() - interval '1 hour', now() - interval '1 minute', 'v23.0');
DO $$ DECLARE result record; BEGIN
  SELECT * INTO result FROM ap.get_meta_connection_status();
  IF result.connected IS TRUE OR result.status <> 'expired' OR result.capabilities <> '{}'::jsonb OR result.granted_scopes <> ARRAY[]::text[] THEN
    RAISE EXCEPTION 'expired connection was exposed as connected';
  END IF;
END $$;

-- A separate shell test invokes this candidate twice concurrently. The trigger
-- keeps the first transaction inside the RPC long enough to prove the row lock.
INSERT INTO ap.meta_oauth_selection_sessions(id, user_id, cliente_id, graph_api_version, facebook_user_id, user_token_secret_ref, expires_at, granted_scopes)
VALUES ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000002', 'v23.0', 'fb-concurrent', vault.create_secret('user-concurrent', 'user-concurrent'), now() + interval '10 minutes', ARRAY['pages_show_list','pages_read_engagement','instagram_basic']);
INSERT INTO ap.meta_oauth_selection_candidates(id, session_id, facebook_page_id, facebook_page_name, instagram_user_id, instagram_username, page_token_secret_ref)
VALUES ('00000000-0000-4000-8000-000000000202', '00000000-0000-4000-8000-000000000102', 'page-concurrent', 'Concurrent', 'ig-concurrent', 'concurrent', vault.create_secret('page-concurrent', 'page-concurrent'));
CREATE FUNCTION ap.meta_test_selection_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.instagram_user_id = 'ig-concurrent' THEN PERFORM pg_sleep(1); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meta_test_selection_delay BEFORE INSERT ON ap.instagram_connections
FOR EACH ROW EXECUTE FUNCTION ap.meta_test_selection_delay();

-- The single-account callback contract uses both immutable flow time and the
-- captured epoch. Old OAuth material and a callback racing deauthorization are
-- rejected, while a genuinely new flow can reconnect.
DO $$
DECLARE old_page uuid := vault.create_secret('epoch-old-page', 'epoch-old-page');
DECLARE old_user uuid := vault.create_secret('epoch-old-user', 'epoch-old-user');
DECLARE first_deauthorized_at timestamptz; flow_after_revoke timestamptz;
DECLARE captured_epoch bigint; fresh_epoch bigint;
BEGIN
  INSERT INTO ap.instagram_connections(cliente_id, provider, status, is_primary, facebook_user_id, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, revocation_secret_ref, connected_at, graph_api_version)
  VALUES ('00000000-0000-4000-8000-000000000001', 'meta', 'connected', false, 'fb-epoch', 'ig-epoch', 'epoch', 'page-epoch', old_page, old_user, now(), 'v23.0');
  PERFORM ap.mark_meta_connections_revoked('fb-epoch');
  SELECT last_deauthorized_at INTO first_deauthorized_at FROM ap.meta_authorizations WHERE facebook_user_id = 'fb-epoch';

  -- A. Callback discovers the Meta identity only after revoke but its flow is old.
  BEGIN
    PERFORM ap.complete_meta_oauth_connection(
      '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001',
      'v23.0', 'fb-epoch', 'stale-user-access-token', NULL, ARRAY[]::text[],
      first_deauthorized_at - interval '1 second', 1,
      jsonb_build_object('facebook_page_id','page-stale','facebook_page_name','Stale','instagram_user_id','ig-epoch','instagram_username','stale','page_access_token','stale-page-access-token')
    );
    RAISE EXCEPTION 'pre-revocation OAuth material reactivated the connection';
  EXCEPTION WHEN SQLSTATE '28000' THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE facebook_user_id = 'fb-epoch' AND status = 'revoked') THEN
    RAISE EXCEPTION 'deauthorization was not preserved after stale reconnect';
  END IF;

  -- B. A flow started after revoke connects through the automatic callback RPC.
  flow_after_revoke := first_deauthorized_at + interval '1 second';
  SELECT ap.capture_meta_authorization_epoch('fb-epoch', flow_after_revoke) INTO captured_epoch;
  PERFORM ap.complete_meta_oauth_connection(
    '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001',
    'v23.0', 'fb-epoch', 'fresh-user-access-token', NULL, ARRAY[]::text[],
    flow_after_revoke, captured_epoch,
    jsonb_build_object('facebook_page_id','page-fresh','facebook_page_name','Fresh','instagram_user_id','ig-epoch','instagram_username','fresh','page_access_token','fresh-page-access-token')
  );
  IF NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE facebook_user_id = 'fb-epoch' AND status = 'connected') THEN
    RAISE EXCEPTION 'new OAuth material after deauthorization did not reconnect';
  END IF;

  -- C. Epoch captured before a subsequent revoke cannot complete afterward.
  PERFORM ap.mark_meta_connections_revoked('fb-epoch');
  BEGIN
    PERFORM ap.complete_meta_oauth_connection(
      '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001',
      'v23.0', 'fb-epoch', 'racing-user-access-token', NULL, ARRAY[]::text[],
      clock_timestamp() + interval '1 second', captured_epoch,
      jsonb_build_object('facebook_page_id','page-racing','facebook_page_name','Racing','instagram_user_id','ig-epoch','instagram_username','racing','page_access_token','racing-page-access-token')
    );
    RAISE EXCEPTION 'epoch mismatch was accepted';
  EXCEPTION WHEN SQLSTATE '28000' THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE facebook_user_id = 'fb-epoch' AND status = 'revoked') THEN
    RAISE EXCEPTION 'epoch mismatch changed revoked connection';
  END IF;

  -- A new OAuth flow snapshots the new epoch and may connect; revoke after its
  -- commit still wins and leaves the final state revoked.
  flow_after_revoke := clock_timestamp() + interval '1 second';
  SELECT ap.capture_meta_authorization_epoch('fb-epoch', flow_after_revoke) INTO fresh_epoch;
  PERFORM ap.complete_meta_oauth_connection(
    '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001',
    'v23.0', 'fb-epoch', 'new-user-access-token', NULL, ARRAY[]::text[],
    flow_after_revoke, fresh_epoch,
    jsonb_build_object('facebook_page_id','page-new','facebook_page_name','New','instagram_user_id','ig-epoch','instagram_username','new','page_access_token','new-page-access-token')
  );
  PERFORM ap.mark_meta_connections_revoked('fb-epoch');
  IF NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE facebook_user_id = 'fb-epoch' AND status = 'revoked') THEN
    RAISE EXCEPTION 'deauthorization after callback completion did not win';
  END IF;
END $$;

-- Selection carries the epoch from callback time; it cannot use a candidate
-- after a global deauthorization event.
DO $$
DECLARE sid uuid := gen_random_uuid();
DECLARE page_secret uuid := vault.create_secret('epoch-selection-page', 'epoch-selection-page');
DECLARE user_secret uuid := vault.create_secret('epoch-selection-user', 'epoch-selection-user');
BEGIN
  INSERT INTO ap.meta_oauth_selection_sessions(id, user_id, cliente_id, graph_api_version, facebook_user_id, user_token_secret_ref, expires_at, granted_scopes, authorization_epoch, flow_started_at)
  VALUES (sid, '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'v23.0', 'fb-selection-epoch', user_secret, now() + interval '5 minutes', ARRAY[]::text[], 0, now() - interval '1 minute');
  INSERT INTO ap.meta_oauth_selection_candidates(session_id, facebook_page_id, facebook_page_name, instagram_user_id, instagram_username, page_token_secret_ref)
  VALUES (sid, 'page-selection-epoch', 'Selection epoch', 'ig-selection-epoch', 'selectionepoch', page_secret);
  PERFORM ap.mark_meta_connections_revoked('fb-selection-epoch');
  BEGIN
    PERFORM ap.select_meta_oauth_candidate((SELECT id FROM ap.meta_oauth_selection_candidates WHERE session_id = sid), '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'selection reactivated a revoked authorization';
  EXCEPTION WHEN SQLSTATE '28000' THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM ap.meta_oauth_selection_sessions WHERE id = sid AND consumed_at IS NULL) THEN
    RAISE EXCEPTION 'revoked selection was consumed';
  END IF;
END $$;

-- Missing temporary secrets are historical garbage, not a permanent global
-- OAuth outage. Expired session cleanup removes their metadata and continues.
DO $$
DECLARE sid uuid := gen_random_uuid();
BEGIN
  INSERT INTO ap.meta_oauth_selection_sessions(id, user_id, cliente_id, graph_api_version, facebook_user_id, user_token_secret_ref, created_at, expires_at, granted_scopes)
  VALUES (sid, '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'v23.0', 'fb-expired-garbage', gen_random_uuid(), now() - interval '2 minutes', now() - interval '1 minute', ARRAY[]::text[]);
  PERFORM ap.cleanup_expired_meta_oauth_sessions(20);
  IF EXISTS (SELECT 1 FROM ap.meta_oauth_selection_sessions WHERE id = sid) THEN
    RAISE EXCEPTION 'expired session with already-removed secret blocked cleanup';
  END IF;
END $$;

-- Vault secret creation, session ownership, and candidates form one atomic
-- boundary. Failures at every stage must leave no session or credential.
DO $$
DECLARE before_count integer; sid uuid; owned_refs uuid[];
BEGIN
  SELECT count(*) INTO before_count FROM vault.secrets;

  -- A. First Vault create fails.
  BEGIN
    PERFORM ap.create_meta_oauth_selection_session(
      '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001',
      'v23.0', 'fb-atomic-first', '__FAIL_VAULT_CREATE__', NULL, ARRAY[]::text[],
      clock_timestamp(), 0, clock_timestamp() + interval '10 minutes', jsonb_build_array(
        jsonb_build_object('facebook_page_id','first-a','facebook_page_name','First A','instagram_user_id','ig-first-a','instagram_username','firsta','page_access_token','first-page-token-a'),
        jsonb_build_object('facebook_page_id','first-b','facebook_page_name','First B','instagram_user_id','ig-first-b','instagram_username','firstb','page_access_token','first-page-token-b')
      )
    );
    RAISE EXCEPTION 'first Vault failure was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;

  -- B. Second Page token fails after user and first Page secrets were created.
  BEGIN
    PERFORM ap.create_meta_oauth_selection_session(
      '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001',
      'v23.0', 'fb-atomic-second', 'atomic-user-token-second', NULL, ARRAY[]::text[],
      clock_timestamp(), 0, clock_timestamp() + interval '10 minutes', jsonb_build_array(
        jsonb_build_object('facebook_page_id','second-a','facebook_page_name','Second A','instagram_user_id','ig-second-a','instagram_username','seconda','page_access_token','second-page-token-a'),
        jsonb_build_object('facebook_page_id','second-b','facebook_page_name','Second B','instagram_user_id','ig-second-b','instagram_username','secondb','page_access_token','__FAIL_VAULT_CREATE__')
      )
    );
    RAISE EXCEPTION 'second Vault failure was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;

  -- C. Session constraint failure occurs after the user secret is created.
  BEGIN
    PERFORM ap.create_meta_oauth_selection_session(
      '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001',
      'latest', 'fb-atomic-session', 'atomic-user-token-session', NULL, ARRAY[]::text[],
      clock_timestamp(), 0, clock_timestamp() + interval '10 minutes', jsonb_build_array(
        jsonb_build_object('facebook_page_id','session-a','facebook_page_name','Session A','instagram_user_id','ig-session-a','instagram_username','sessiona','page_access_token','session-page-token-a'),
        jsonb_build_object('facebook_page_id','session-b','facebook_page_name','Session B','instagram_user_id','ig-session-b','instagram_username','sessionb','page_access_token','session-page-token-b')
      )
    );
    RAISE EXCEPTION 'invalid session insert was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- D. Duplicate candidate fails after both Page secrets were created.
  BEGIN
    PERFORM ap.create_meta_oauth_selection_session(
      '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001',
      'v23.0', 'fb-atomic-candidate', 'atomic-user-token-candidate', NULL, ARRAY[]::text[],
      clock_timestamp(), 0, clock_timestamp() + interval '10 minutes', jsonb_build_array(
        jsonb_build_object('facebook_page_id','duplicate','facebook_page_name','Duplicate A','instagram_user_id','ig-duplicate','instagram_username','duplicatea','page_access_token','candidate-page-token-a'),
        jsonb_build_object('facebook_page_id','duplicate','facebook_page_name','Duplicate B','instagram_user_id','ig-duplicate','instagram_username','duplicateb','page_access_token','candidate-page-token-b')
      )
    );
    RAISE EXCEPTION 'duplicate candidate insert was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  IF (SELECT count(*) FROM vault.secrets) <> before_count
     OR EXISTS (SELECT 1 FROM ap.meta_oauth_selection_sessions WHERE facebook_user_id LIKE 'fb-atomic-%') THEN
    RAISE EXCEPTION 'atomic session failure left Vault or session residue';
  END IF;

  -- E/F. Success owns every ref; expiry cleanup removes session and secrets.
  SELECT ap.create_meta_oauth_selection_session(
    '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001',
    'v23.0', 'fb-atomic-success', 'atomic-user-token-success', NULL, ARRAY[]::text[],
    clock_timestamp(), 0, clock_timestamp() + interval '10 minutes', jsonb_build_array(
      jsonb_build_object('facebook_page_id','success-a','facebook_page_name','Success A','instagram_user_id','ig-success-a','instagram_username','successa','page_access_token','success-page-token-a'),
      jsonb_build_object('facebook_page_id','success-b','facebook_page_name','Success B','instagram_user_id','ig-success-b','instagram_username','successb','page_access_token','success-page-token-b')
    )
  ) INTO sid;
  SELECT array_agg(secret_ref) INTO owned_refs FROM (
    SELECT user_token_secret_ref AS secret_ref FROM ap.meta_oauth_selection_sessions WHERE id = sid
    UNION ALL
    SELECT page_token_secret_ref FROM ap.meta_oauth_selection_candidates WHERE session_id = sid
  ) refs;
  IF cardinality(owned_refs) <> 3
     OR EXISTS (SELECT 1 FROM unnest(owned_refs) ref WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE id = ref)) THEN
    RAISE EXCEPTION 'successful session does not own all Vault refs';
  END IF;
  UPDATE ap.meta_oauth_selection_sessions
     SET created_at = clock_timestamp() - interval '2 seconds',
         expires_at = clock_timestamp() - interval '1 second'
   WHERE id = sid;
  PERFORM ap.cleanup_expired_meta_oauth_sessions(20);
  IF EXISTS (SELECT 1 FROM ap.meta_oauth_selection_sessions WHERE id = sid)
     OR EXISTS (SELECT 1 FROM vault.secrets WHERE id = ANY(owned_refs)) THEN
    RAISE EXCEPTION 'expired atomic session cleanup did not remove owned refs';
  END IF;
END $$;

-- A revoked historical row sharing an already-deleted ref converges without
-- touching a connection that is still active.
DO $$
DECLARE shared_ref uuid := gen_random_uuid();
DECLARE revoked_id uuid;
BEGIN
  INSERT INTO ap.instagram_connections(cliente_id, provider, status, facebook_user_id, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, connected_at, graph_api_version, secret_cleanup_pending)
  VALUES ('00000000-0000-4000-8000-000000000002', 'meta', 'revoked', 'fb-shared-garbage', 'ig-shared-garbage', 'sharedgarbage', 'page-shared-garbage', shared_ref, now(), 'v23.0', true)
  RETURNING id INTO revoked_id;
  PERFORM ap.cleanup_revoked_meta_connection(revoked_id);
  IF NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE id = revoked_id AND token_secret_ref IS NULL AND secret_cleanup_pending IS FALSE) THEN
    RAISE EXCEPTION 'revoked shared historical ref did not converge';
  END IF;
END $$;

-- RLS and grants are checked in PostgreSQL's privilege catalog.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'ap' AND c.relname IN ('instagram_connections','meta_authorizations','meta_oauth_states','meta_oauth_selection_sessions','meta_oauth_selection_candidates')
      AND c.relrowsecurity IS NOT TRUE
  ) THEN RAISE EXCEPTION 'Meta table missing RLS'; END IF;
  IF has_table_privilege('anon', 'ap.instagram_connections', 'SELECT')
     OR has_table_privilege('authenticated', 'ap.meta_oauth_states', 'SELECT')
     OR has_table_privilege('authenticated', 'ap.meta_authorizations', 'SELECT') THEN
    RAISE EXCEPTION 'frontend role has direct Meta connection table access';
  END IF;
  IF EXISTS (
       SELECT 1
       FROM pg_proc p
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       WHERE p.oid = 'ap.complete_meta_oauth_connection(uuid,uuid,text,text,text,timestamptz,text[],timestamptz,bigint,jsonb)'::regprocedure
         AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
     )
     OR has_function_privilege('anon', 'ap.create_meta_oauth_selection_session(uuid,uuid,text,text,text,timestamptz,text[],timestamptz,bigint,timestamptz,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'ap.capture_meta_authorization_epoch(text,timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'ap.complete_meta_oauth_connection(uuid,uuid,text,text,text,timestamptz,text[],timestamptz,bigint,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'raw-token RPC grants are unsafe';
  END IF;
END $$;
