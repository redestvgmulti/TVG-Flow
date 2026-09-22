\set ON_ERROR_STOP on

-- Run after meta-connection-postgres.sql. The trigger pauses the connection
-- write while it still owns the canonical Meta authorization advisory lock.
CREATE OR REPLACE FUNCTION ap.meta_test_deauthorize_delay() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.instagram_user_id IN ('ig-deauth-race', 'ig-deauth-selection') THEN
    PERFORM pg_sleep(1);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meta_test_deauthorize_delay BEFORE UPDATE ON ap.instagram_connections
FOR EACH ROW EXECUTE FUNCTION ap.meta_test_deauthorize_delay();

INSERT INTO ap.instagram_connections(cliente_id, provider, status, is_primary, facebook_user_id, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, revocation_secret_ref, connected_at, graph_api_version)
VALUES ('00000000-0000-4000-8000-000000000002', 'meta', 'connected', false, 'fb-deauth-race', 'ig-deauth-race', 'oldrace', 'page-old-race', vault.create_secret('deauth-old-page', 'deauth-old-page'), vault.create_secret('deauth-old-user', 'deauth-old-user'), now(), 'v23.0');
SELECT vault.create_secret('deauth-new-page', 'deauth-new-page');
SELECT vault.create_secret('deauth-new-user', 'deauth-new-user');

INSERT INTO ap.instagram_connections(cliente_id, provider, status, is_primary, facebook_user_id, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, revocation_secret_ref, connected_at, graph_api_version)
VALUES ('00000000-0000-4000-8000-000000000002', 'meta', 'connected', false, 'fb-deauth-selection', 'ig-deauth-selection', 'oldselection', 'page-old-selection', vault.create_secret('deauth-selection-old-page', 'deauth-selection-old-page'), vault.create_secret('deauth-selection-old-user', 'deauth-selection-old-user'), now(), 'v23.0');
INSERT INTO ap.meta_oauth_selection_sessions(id, user_id, cliente_id, graph_api_version, facebook_user_id, user_token_secret_ref, expires_at, granted_scopes, authorization_epoch, flow_started_at)
VALUES ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000002', 'v23.0', 'fb-deauth-selection', vault.create_secret('deauth-selection-user', 'deauth-selection-user'), now() + interval '10 minutes', ARRAY[]::text[], 0, now());
INSERT INTO ap.meta_oauth_selection_candidates(id, session_id, facebook_page_id, facebook_page_name, instagram_user_id, instagram_username, page_token_secret_ref)
VALUES ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000301', 'page-deauth-selection', 'Deauth selection', 'ig-deauth-selection', 'selectionrace', vault.create_secret('deauth-selection-page', 'deauth-selection-page'));
