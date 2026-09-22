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
  PERFORM ap.reconnect_meta_connection('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000011', 'fb-tx', 'ig-tx', 'new', 'page-new', 'New', new_page, new_user, ARRAY['instagram_basic'], '{}'::jsonb, 'v23.0', now() + interval '1 hour');
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
    PERFORM ap.reconnect_meta_connection('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000011', 'fb-fail', 'ig-retry', 'new', 'page-new', 'New', new_page, new_user, ARRAY[]::text[], '{}'::jsonb, 'v23.0', NULL);
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

-- A global Meta deauthorization advances the authorization epoch. OAuth
-- material whose state began before that event can never restore connected.
DO $$
DECLARE old_page uuid := vault.create_secret('epoch-old-page', 'epoch-old-page');
DECLARE old_user uuid := vault.create_secret('epoch-old-user', 'epoch-old-user');
DECLARE fresh_page uuid := vault.create_secret('epoch-fresh-page', 'epoch-fresh-page');
DECLARE fresh_user uuid := vault.create_secret('epoch-fresh-user', 'epoch-fresh-user');
BEGIN
  INSERT INTO ap.instagram_connections(cliente_id, provider, status, is_primary, facebook_user_id, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, revocation_secret_ref, connected_at, graph_api_version)
  VALUES ('00000000-0000-4000-8000-000000000001', 'meta', 'connected', false, 'fb-epoch', 'ig-epoch', 'epoch', 'page-epoch', old_page, old_user, now(), 'v23.0');
  PERFORM ap.mark_meta_connections_revoked('fb-epoch');
  BEGIN
    PERFORM ap.reconnect_meta_connection('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', 'fb-epoch', 'ig-epoch', 'stale', 'page-stale', 'Stale', fresh_page, fresh_user, ARRAY[]::text[], '{}'::jsonb, 'v23.0', NULL, now() - interval '1 minute', 0);
    RAISE EXCEPTION 'pre-revocation OAuth material reactivated the connection';
  EXCEPTION WHEN SQLSTATE '28000' THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE facebook_user_id = 'fb-epoch' AND status = 'revoked') THEN
    RAISE EXCEPTION 'deauthorization was not preserved after stale reconnect';
  END IF;
  PERFORM ap.reconnect_meta_connection('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011', 'fb-epoch', 'ig-epoch', 'fresh', 'page-fresh', 'Fresh', fresh_page, fresh_user, ARRAY[]::text[], '{}'::jsonb, 'v23.0', NULL, now() + interval '1 second', 1);
  IF NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE facebook_user_id = 'fb-epoch' AND status = 'connected') THEN
    RAISE EXCEPTION 'new OAuth material after deauthorization did not reconnect';
  END IF;
  PERFORM ap.mark_meta_connections_revoked('fb-epoch');
  IF NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE facebook_user_id = 'fb-epoch' AND status = 'revoked') THEN
    RAISE EXCEPTION 'deauthorization after reconnect did not win';
  END IF;
END $$;

-- Selection carries the epoch from callback time; it cannot use a candidate
-- after a global deauthorization event.
DO $$
DECLARE sid uuid := gen_random_uuid();
DECLARE page_secret uuid := vault.create_secret('epoch-selection-page', 'epoch-selection-page');
DECLARE user_secret uuid := vault.create_secret('epoch-selection-user', 'epoch-selection-user');
BEGIN
  INSERT INTO ap.meta_oauth_selection_sessions(id, user_id, cliente_id, graph_api_version, facebook_user_id, user_token_secret_ref, expires_at, granted_scopes, authorization_epoch, oauth_started_at)
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

-- Session creation is atomic: a missing later candidate ref leaves neither a
-- valid-looking session nor candidate metadata behind.
DO $$
DECLARE user_secret uuid := vault.create_secret('partial-session-user', 'partial-session-user');
DECLARE valid_page uuid := vault.create_secret('partial-session-page', 'partial-session-page');
BEGIN
  BEGIN
    PERFORM ap.create_meta_oauth_selection_session(
      '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001',
      'v23.0', 'fb-partial-session', user_secret, NULL, ARRAY[]::text[], now(),
      now() + interval '10 minutes', jsonb_build_array(
        jsonb_build_object('facebook_page_id','partial-a','facebook_page_name','Partial A','instagram_user_id','ig-partial-a','instagram_username','partiala','page_token_secret_ref',valid_page),
        jsonb_build_object('facebook_page_id','partial-b','facebook_page_name','Partial B','instagram_user_id','ig-partial-b','instagram_username','partialb','page_token_secret_ref',gen_random_uuid())
      )
    );
    RAISE EXCEPTION 'partial selection session was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM ap.meta_oauth_selection_sessions WHERE facebook_user_id = 'fb-partial-session') THEN
    RAISE EXCEPTION 'partial callback session was persisted';
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
    WHERE n.nspname = 'ap' AND c.relname IN ('instagram_connections','meta_oauth_states','meta_oauth_selection_sessions','meta_oauth_selection_candidates')
      AND c.relrowsecurity IS NOT TRUE
  ) THEN RAISE EXCEPTION 'Meta table missing RLS'; END IF;
  IF has_table_privilege('anon', 'ap.instagram_connections', 'SELECT')
     OR has_table_privilege('authenticated', 'ap.meta_oauth_states', 'SELECT') THEN
    RAISE EXCEPTION 'frontend role has direct Meta connection table access';
  END IF;
END $$;
