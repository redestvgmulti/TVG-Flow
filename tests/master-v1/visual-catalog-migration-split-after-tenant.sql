-- Proves that catalog DML is isolated to the operational tenant and replay-safe.
DO $tenant_assertions$
DECLARE
    v_operational_catalog_count integer;
    v_new_disabled_count integer;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM ap.master_render_configs AS c
        WHERE c.cliente_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
          AND c.visual_model = 'misto'
          AND c.master_template_uuid = 'tenant-b-misto-template'
          AND c.enabled
          AND c.sponsor_count IS NULL
    ) THEN
        RAISE EXCEPTION 'TENANT_MIGRATION_CHANGED_TENANT_B_MISTO';
    END IF;

    IF (
        SELECT count(*)
        FROM ap.master_render_configs AS c
        WHERE c.cliente_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
    ) <> 1 THEN
        RAISE EXCEPTION 'TENANT_B_RECEIVED_CATALOG_MASTERS';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM operational_enabled_before AS before
        JOIN ap.master_render_configs AS current
          ON current.id = before.id
        WHERE current.enabled IS DISTINCT FROM before.enabled
    ) THEN
        RAISE EXCEPTION 'EXISTING_MASTER_ENABLED_CHANGED';
    END IF;

    SELECT count(*)::integer
    INTO v_operational_catalog_count
    FROM ap.master_render_configs AS c
    JOIN (VALUES
        ('feed', 'tvg', 'mzszfje7xdh6l', 2::smallint),
        ('reels', 'tvg', 'xcxtk9tt7syfd', 2::smallint),
        ('feed', 'tvg_img', '3pm4re4blrizh', 1::smallint),
        ('reels', 'tvg_img', 'rrbcykdqcrqae', 1::smallint),
        ('feed', 'individual', '4e7pghwb4beji', 1::smallint),
        ('reels', 'individual', '5wtiafeuc52hi', NULL::smallint),
        ('story', 'story', 'x3djtbqorrtqc', 2::smallint),
        ('reels', 'aparecida', '91gsgmxj1irqh', NULL::smallint)
    ) AS expected(content_type, visual_model, template_uuid, sponsor_count)
      ON expected.content_type = c.content_type
     AND expected.visual_model = c.visual_model
     AND expected.template_uuid = c.master_template_uuid
     AND c.sponsor_count IS NOT DISTINCT FROM expected.sponsor_count
    WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid;

    IF v_operational_catalog_count <> 8 THEN
        RAISE EXCEPTION
            'OPERATIONAL_CATALOG_INCOMPLETE expected=8 actual=%',
            v_operational_catalog_count;
    END IF;

    SELECT count(*)::integer
    INTO v_new_disabled_count
    FROM ap.master_render_configs AS c
    WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
      AND (
          (c.content_type = 'feed' AND c.visual_model = 'individual')
          OR (c.content_type = 'reels' AND c.visual_model = 'individual')
          OR (c.content_type = 'story' AND c.visual_model = 'story')
          OR (c.content_type = 'reels' AND c.visual_model = 'aparecida')
      )
      AND NOT c.enabled;

    IF v_new_disabled_count <> 4 THEN
        RAISE EXCEPTION
            'NEW_MASTERS_NOT_DISABLED expected=4 actual=%',
            v_new_disabled_count;
    END IF;

    IF EXISTS (
        (
            SELECT before.row_data FROM candidate_rows_before AS before
            EXCEPT ALL
            SELECT to_jsonb(news) FROM ap.candidate_news AS news
        )
        UNION ALL
        (
            SELECT to_jsonb(news) FROM ap.candidate_news AS news
            EXCEPT ALL
            SELECT before.row_data FROM candidate_rows_before AS before
        )
    ) THEN
        RAISE EXCEPTION 'TENANT_MIGRATION_CHANGED_CANDIDATES';
    END IF;
END;
$tenant_assertions$;
