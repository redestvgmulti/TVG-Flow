\set ON_ERROR_STOP on

SELECT pg_sleep(0.25);
SELECT ap.mark_meta_connections_revoked('fb-monotonic-race');
INSERT INTO ap.meta_test_deauth_observations(label, observed_at)
SELECT 'second_effective', last_deauthorized_at
FROM ap.meta_authorizations
WHERE facebook_user_id = 'fb-monotonic-race';
