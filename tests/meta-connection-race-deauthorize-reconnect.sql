\set ON_ERROR_STOP on
SELECT ap.reconnect_meta_connection(
  '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000011',
  'fb-deauth-race', 'ig-deauth-race', 'newrace', 'page-new-race', 'New race',
  (SELECT id FROM vault.secrets WHERE name = 'deauth-new-page'),
  (SELECT id FROM vault.secrets WHERE name = 'deauth-new-user'),
  ARRAY[]::text[], '{}'::jsonb, 'v23.0', NULL, now(), 0
);
