\set ON_ERROR_STOP on

DELETE FROM ap.meta_authorizations WHERE facebook_user_id = 'fb-monotonic-race';
DELETE FROM ap.instagram_connections WHERE facebook_user_id = 'fb-monotonic-race';
DROP TABLE IF EXISTS ap.meta_test_deauth_observations;
CREATE TABLE ap.meta_test_deauth_observations (
  label text PRIMARY KEY,
  observed_at timestamptz NOT NULL
);
