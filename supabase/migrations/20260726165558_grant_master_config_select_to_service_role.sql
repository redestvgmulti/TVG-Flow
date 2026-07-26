-- AutoPublisher P0: the server-side generator reads the master configuration
-- with the service role. Grant only the object privilege it needs; RLS,
-- ownership and every write privilege remain unchanged.
GRANT SELECT ON TABLE
    ap.master_render_controls,
    ap.master_render_configs,
    ap.template_render_profiles
TO service_role;
