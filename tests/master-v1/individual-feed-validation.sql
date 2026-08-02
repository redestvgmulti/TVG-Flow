-- Read-only pre-enable validation for the operational tenant.
-- Run only after the visual catalog migration has been applied.
DO $validation$
DECLARE
    v_master_id uuid;
    v_pool_count integer;
BEGIN
    SELECT c.id
    INTO STRICT v_master_id
    FROM ap.master_render_configs AS c
    WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
      AND c.content_type = 'feed'
      AND c.visual_model = 'individual'
      AND c.template_set = 'default'
      AND c.master_template_uuid = '4e7pghwb4beji'
      AND c.sponsor_count = 1
      AND c.layer_map = '{"headline":"titulo-materia","news_image":"news-image","visual_title":"titulo-png","sponsor_1":"patrocinador-2"}'::jsonb
      AND c.enabled = false;

    IF EXISTS (
        SELECT 1
        FROM ap.master_render_configs AS c
        WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
          AND c.master_template_uuid = '4e7pghwb4beji'
          AND c.id <> v_master_id
    ) THEN
        RAISE EXCEPTION 'INDIVIDUAL_FEED_MASTER_CONFLICT';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM ap.master_render_configs AS c
        WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
          AND c.content_type = 'feed'
          AND c.visual_model = 'individual'
          AND c.id <> v_master_id
    ) THEN
        RAISE EXCEPTION 'INDIVIDUAL_FEED_SCOPE_CONFLICT';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM ap.master_render_controls AS ctl
        WHERE ctl.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
          AND ctl.kill_switch
    ) THEN
        RAISE EXCEPTION 'MASTER_KILL_SWITCH_ACTIVE';
    END IF;

    SELECT count(DISTINCT m.sponsor_id)::integer
    INTO v_pool_count
    FROM ap.render_sponsor_scope_memberships AS m
    JOIN ap.render_sponsors AS s
      ON s.id = m.sponsor_id
     AND s.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
    WHERE m.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
      AND m.template_set = 'default'
      AND m.content_type = 'feed'
      AND m.ativo
      AND s.ativo;

    IF v_pool_count < 1 THEN
        RAISE EXCEPTION 'SPONSOR_POOL_INSUFFICIENT requested=1 available=%',
            v_pool_count;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM ap.visual_titles AS t
        WHERE t.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
          AND t.ativo
          AND 'feed' = ANY (t.formatos)
    ) THEN
        RAISE EXCEPTION 'VISUAL_TITLE_NOT_AVAILABLE_FOR_FEED';
    END IF;
END;
$validation$;

SELECT
    c.id,
    c.cliente_id,
    c.content_type,
    c.visual_model,
    c.master_template_uuid,
    c.sponsor_count,
    c.layer_map,
    c.enabled
FROM ap.master_render_configs AS c
WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
  AND c.content_type = 'feed'
  AND c.visual_model = 'individual'
  AND c.master_template_uuid = '4e7pghwb4beji';
