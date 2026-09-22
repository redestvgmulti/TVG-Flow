\set ON_ERROR_STOP on

DO $$
DECLARE final_epoch bigint; final_time timestamptz; second_time timestamptz;
DECLARE secret_count integer;
BEGIN
  SELECT authorization_epoch, last_deauthorized_at
    INTO final_epoch, final_time
    FROM ap.meta_authorizations
    WHERE facebook_user_id = 'fb-monotonic-race';
  SELECT observed_at INTO second_time
    FROM ap.meta_test_deauth_observations WHERE label = 'second_effective';
  IF final_epoch <> 2 THEN
    RAISE EXCEPTION 'concurrent deauthorization lost epoch increment: %', final_epoch;
  END IF;
  IF final_time < second_time THEN
    RAISE EXCEPTION 'last_deauthorized_at regressed: final %, second %', final_time, second_time;
  END IF;

  -- Model the formerly vulnerable one-account callback: it can read the new
  -- epoch after revoke, but its immutable flow timestamp is still old.
  SELECT count(*) INTO secret_count FROM vault.secrets;
  BEGIN
    PERFORM ap.complete_meta_oauth_connection(
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000001',
      'v23.0', 'fb-monotonic-race', 'old-flow-user-token', NULL, ARRAY[]::text[],
      second_time - interval '1 second', final_epoch,
      jsonb_build_object(
        'facebook_page_id','old-flow-page',
        'facebook_page_name','Old flow',
        'instagram_user_id','ig-old-flow',
        'instagram_username','oldflow',
        'page_access_token','old-flow-page-token'
      )
    );
    RAISE EXCEPTION 'old OAuth automatic callback was accepted';
  EXCEPTION WHEN SQLSTATE '28000' THEN NULL;
  END;
  IF EXISTS (
      SELECT 1 FROM ap.instagram_connections
      WHERE facebook_user_id = 'fb-monotonic-race' AND status = 'connected'
    ) OR (SELECT count(*) FROM vault.secrets) <> secret_count THEN
    RAISE EXCEPTION 'rejected old OAuth left a connection or Vault secret';
  END IF;
END $$;
