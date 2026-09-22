\set ON_ERROR_STOP on
SELECT ap.reconnect_meta_connection('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000011','fb-race','ig-race','two','page-two','Two',(SELECT id FROM vault.secrets WHERE name = 'rr-two-page'),(SELECT id FROM vault.secrets WHERE name = 'rr-two-user'),ARRAY[]::text[],'{}'::jsonb,'v23.0',NULL);
