\set ON_ERROR_STOP on

-- Run after meta-connection-postgres.sql. The update delay makes the first
-- transaction visibly hold the advisory/row locks while a competing request
-- waits, so the final assertions detect lost updates and orphan Vault refs.
INSERT INTO public.clientes(id) VALUES ('00000000-0000-4000-8000-000000000004');
INSERT INTO public.cliente_profissionais(profissional_id, cliente_id) VALUES
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000004');
INSERT INTO ap.instagram_connections(cliente_id, provider, status, is_primary, facebook_user_id, instagram_user_id, instagram_username, facebook_page_id, token_secret_ref, revocation_secret_ref, connected_at, graph_api_version)
VALUES ('00000000-0000-4000-8000-000000000004', 'meta', 'connected', true, 'fb-race', 'ig-race', 'old', 'page-old', vault.create_secret('old-page-race', 'race-old-page'), vault.create_secret('old-user-race', 'race-old-user'), now(), 'v23.0');
SELECT vault.create_secret('new-page-race', 'race-new-page');
SELECT vault.create_secret('new-user-race', 'race-new-user');
CREATE OR REPLACE FUNCTION ap.meta_test_connection_delay() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.instagram_user_id = 'ig-race' THEN PERFORM pg_sleep(1); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER meta_test_connection_delay BEFORE UPDATE ON ap.instagram_connections
FOR EACH ROW EXECUTE FUNCTION ap.meta_test_connection_delay();
