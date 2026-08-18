-- ap.template_sets is managed exclusively through the authorized ap-config
-- Edge Function. Browser/PostgREST access must not bypass that gate.
DROP POLICY IF EXISTS "Ap Template Sets Full Access" ON ap.template_sets;

REVOKE ALL ON TABLE ap.template_sets FROM PUBLIC;
REVOKE ALL ON TABLE ap.template_sets FROM anon;
REVOKE ALL ON TABLE ap.template_sets FROM authenticated;

-- The service role is used only after ap-config completes JWT, profile, role
-- and operational-client authorization. The table owner retains normal DDL
-- and migration access; FORCE RLS is intentionally not enabled here.
GRANT ALL ON TABLE ap.template_sets TO service_role;
