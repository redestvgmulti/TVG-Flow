\set ON_ERROR_STOP on
SELECT ap.reconnect_meta_connection(
  '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000011',
  'fb-race', 'ig-race', 'new', 'page-new', 'New',
  (SELECT id FROM vault.secrets WHERE name = 'race-new-page'),
  (SELECT id FROM vault.secrets WHERE name = 'race-new-user'),
  ARRAY['instagram_basic'], '{}'::jsonb, 'v23.0', now() + interval '1 hour',
  clock_timestamp(), 0
);
