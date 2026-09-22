\set ON_ERROR_STOP on

BEGIN;
SELECT pg_sleep(2);
SELECT ap.mark_meta_connections_revoked('fb-monotonic-race');
COMMIT;
