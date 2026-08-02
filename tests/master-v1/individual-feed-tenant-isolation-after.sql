-- Assertions executed immediately after individual-feed-enable.sql.
DO $tenant_isolation$
DECLARE
    v_operational_enabled boolean;
    v_foreign_enabled boolean;
BEGIN
    SELECT c.enabled
    INTO STRICT v_operational_enabled
    FROM ap.master_render_configs AS c
    WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
      AND c.content_type = 'feed'
      AND c.visual_model = 'individual'
      AND c.master_template_uuid = '4e7pghwb4beji';

    SELECT c.enabled
    INTO STRICT v_foreign_enabled
    FROM ap.master_render_configs AS c
    WHERE c.cliente_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid
      AND c.content_type = 'feed'
      AND c.visual_model = 'individual'
      AND c.master_template_uuid = '4e7pghwb4beji';

    IF v_operational_enabled IS NOT TRUE THEN
        RAISE EXCEPTION 'OPERATIONAL_TENANT_NOT_ENABLED';
    END IF;

    IF v_foreign_enabled IS NOT FALSE THEN
        RAISE EXCEPTION 'FOREIGN_TENANT_WAS_ENABLED';
    END IF;
END;
$tenant_isolation$;
