\set ON_ERROR_STOP on
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ap.instagram_connections WHERE facebook_user_id IN ('fb-deauth-race', 'fb-deauth-selection') AND status = 'connected') THEN
    RAISE EXCEPTION 'deauthorize race left a connected connection';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE facebook_user_id = 'fb-deauth-race' AND status = 'revoked')
     OR NOT EXISTS (SELECT 1 FROM ap.instagram_connections WHERE facebook_user_id = 'fb-deauth-selection' AND status = 'revoked') THEN
    RAISE EXCEPTION 'deauthorize race did not end revoked';
  END IF;
END $$;
