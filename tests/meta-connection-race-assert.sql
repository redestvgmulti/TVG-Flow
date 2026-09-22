\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ap.instagram_connections
    WHERE cliente_id = '00000000-0000-4000-8000-000000000004' AND instagram_user_id = 'ig-race'
      AND status = 'disconnected' AND token_secret_ref IS NULL AND revocation_secret_ref IS NULL
  ) THEN RAISE EXCEPTION 'disconnect/reconnect lost-update result'; END IF;
  IF EXISTS (SELECT 1 FROM vault.secrets WHERE name IN ('race-old-page','race-old-user','race-new-page','race-new-user')) THEN
    RAISE EXCEPTION 'disconnect/reconnect left an orphan secret';
  END IF;
END $$;
