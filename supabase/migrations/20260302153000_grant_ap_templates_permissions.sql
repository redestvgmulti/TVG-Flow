-- Grant schema usage to anon, authenticated, service_role if not already granted
GRANT USAGE ON SCHEMA ap TO anon, authenticated, service_role;

-- Grant capabilities onto ap.templates
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ap.templates TO anon, authenticated, service_role;

-- Grant capabilities onto ap.template_queue_state
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ap.template_queue_state TO anon, authenticated, service_role;
