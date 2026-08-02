-- AutoPublisher visual catalog data for the operational tenant only.
--
-- This migration is intentionally tenant-bound. It never discovers a tenant
-- from template UUIDs, never changes enabled on existing masters and never
-- reads or writes candidate_news or frozen snapshots.

DO $tenant_catalog$
DECLARE
    v_existing_master_count integer;
    v_new_master_count integer;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.clientes AS client
        WHERE client.id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
    ) THEN
        RAISE EXCEPTION 'AUTOPUBLISHER_OPERATIONAL_TENANT_NOT_FOUND'
            USING ERRCODE = '23503';
    END IF;

    -- Conversion must never merge misto with an already-existing tvg_img row.
    IF EXISTS (
        SELECT 1
        FROM ap.master_render_configs AS legacy
        JOIN ap.master_render_configs AS current
          ON current.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
         AND current.content_type = legacy.content_type
         AND current.visual_model = 'tvg_img'
        WHERE legacy.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
          AND legacy.visual_model = 'misto'
    ) THEN
        RAISE EXCEPTION 'MASTER_RENDER_CONFIG_TVG_IMG_COLLISION'
            USING ERRCODE = '23505';
    END IF;

    -- Replay-safe inventory: on first application IMG may still be misto; on
    -- subsequent applications it is already tvg_img.
    IF EXISTS (
        SELECT 1
        FROM ap.master_render_configs AS c
        JOIN (VALUES
            ('feed', 'tvg', 'mzszfje7xdh6l'),
            ('reels', 'tvg', 'xcxtk9tt7syfd'),
            ('feed', 'tvg_img', '3pm4re4blrizh'),
            ('reels', 'tvg_img', 'rrbcykdqcrqae')
        ) AS expected(content_type, visual_model, template_uuid)
          ON expected.content_type = c.content_type
         AND (
             c.visual_model = expected.visual_model
             OR (
                 expected.visual_model = 'tvg_img'
                 AND c.visual_model = 'misto'
             )
         )
        WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
          AND c.master_template_uuid IS DISTINCT FROM expected.template_uuid
    ) THEN
        RAISE EXCEPTION 'AUTOPUBLISHER_EXISTING_MASTER_UUID_MISMATCH'
            USING ERRCODE = '23514';
    END IF;

    SELECT count(*)::integer
    INTO v_existing_master_count
    FROM ap.master_render_configs AS c
    JOIN (VALUES
        ('feed', 'tvg', 'mzszfje7xdh6l'),
        ('reels', 'tvg', 'xcxtk9tt7syfd'),
        ('feed', 'tvg_img', '3pm4re4blrizh'),
        ('reels', 'tvg_img', 'rrbcykdqcrqae')
    ) AS expected(content_type, visual_model, template_uuid)
      ON expected.content_type = c.content_type
     AND (
         c.visual_model = expected.visual_model
         OR (
             expected.visual_model = 'tvg_img'
             AND c.visual_model = 'misto'
         )
     )
     AND c.master_template_uuid = expected.template_uuid
    WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid;

    IF v_existing_master_count <> 4 THEN
        RAISE EXCEPTION
            'AUTOPUBLISHER_EXISTING_MASTER_SET_INCOMPLETE expected=4 actual=%',
            v_existing_master_count
            USING ERRCODE = '23514';
    END IF;

    -- Live configuration is renamed only for the operational tenant.
    -- enabled is deliberately absent from SET.
    UPDATE ap.master_render_configs AS c
    SET visual_model = 'tvg_img'
    WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
      AND c.visual_model = 'misto';

    -- Existing UUIDs and enabled flags are deliberately absent from SET.
    UPDATE ap.master_render_configs AS c
    SET layer_map = expected.layer_map,
        sponsor_count = expected.sponsor_count
    FROM (VALUES
        ('feed', 'tvg', 'mzszfje7xdh6l', 2::smallint,
         '{"headline":"titulo-materia","news_image":"news-image","visual_title":"titulo-png","sponsor_1":"patrocinador-1","sponsor_2":"patrocinador-2"}'::jsonb),
        ('reels', 'tvg', 'xcxtk9tt7syfd', 2::smallint,
         '{"headline":"titulo-materia","visual_title":"titulo-png","sponsor_1":"patrocinador-1","sponsor_2":"patrocinador-2"}'::jsonb),
        ('feed', 'tvg_img', '3pm4re4blrizh', 1::smallint,
         '{"headline":"titulo-materia","news_image":"news-image","visual_title":"titulo-png","sponsor_1":"patrocinador-1"}'::jsonb),
        ('reels', 'tvg_img', 'rrbcykdqcrqae', 1::smallint,
         '{"headline":"titulo-materia","visual_title":"titulo-png","sponsor_1":"patrocinador-1"}'::jsonb)
    ) AS expected(
        content_type,
        visual_model,
        template_uuid,
        sponsor_count,
        layer_map
    )
    WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
      AND c.content_type = expected.content_type
      AND c.visual_model = expected.visual_model
      AND c.master_template_uuid = expected.template_uuid
      AND (
          c.layer_map IS DISTINCT FROM expected.layer_map
          OR c.sponsor_count IS DISTINCT FROM expected.sponsor_count
      );

    -- A pre-existing row may be reused only when both its business scope and
    -- immutable Placid UUID are exact.
    IF EXISTS (
        SELECT 1
        FROM ap.master_render_configs AS c
        JOIN (VALUES
            ('feed', 'individual', '4e7pghwb4beji'),
            ('reels', 'individual', '5wtiafeuc52hi'),
            ('story', 'story', 'x3djtbqorrtqc'),
            ('reels', 'aparecida', '91gsgmxj1irqh')
        ) AS expected(content_type, visual_model, template_uuid)
          ON expected.content_type = c.content_type
         AND expected.visual_model = c.visual_model
        WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
          AND c.master_template_uuid IS DISTINCT FROM expected.template_uuid
    ) THEN
        RAISE EXCEPTION 'AUTOPUBLISHER_NEW_MASTER_SCOPE_COLLISION'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM ap.master_render_configs AS c
        JOIN (VALUES
            ('feed', 'individual', '4e7pghwb4beji'),
            ('reels', 'individual', '5wtiafeuc52hi'),
            ('story', 'story', 'x3djtbqorrtqc'),
            ('reels', 'aparecida', '91gsgmxj1irqh')
        ) AS expected(content_type, visual_model, template_uuid)
          ON expected.template_uuid = c.master_template_uuid
        WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
          AND (
              c.content_type IS DISTINCT FROM expected.content_type
              OR c.visual_model IS DISTINCT FROM expected.visual_model
          )
    ) THEN
        RAISE EXCEPTION 'AUTOPUBLISHER_NEW_MASTER_UUID_COLLISION'
            USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM ap.master_render_configs AS c
        JOIN (VALUES
            ('feed', 'individual', '4e7pghwb4beji'),
            ('reels', 'individual', '5wtiafeuc52hi'),
            ('story', 'story', 'x3djtbqorrtqc'),
            ('reels', 'aparecida', '91gsgmxj1irqh')
        ) AS expected(content_type, visual_model, template_uuid)
          ON expected.content_type = c.content_type
         AND expected.visual_model = c.visual_model
         AND expected.template_uuid = c.master_template_uuid
        WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
          AND c.enabled
    ) THEN
        RAISE EXCEPTION 'AUTOPUBLISHER_NEW_MASTER_ALREADY_ENABLED'
            USING ERRCODE = '23514';
    END IF;

    INSERT INTO ap.master_render_configs (
        cliente_id,
        content_type,
        template_set,
        visual_model,
        master_template_uuid,
        enabled,
        sponsor_count,
        layer_map
    )
    VALUES
        (
            'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid,
            'feed', 'default', 'individual', '4e7pghwb4beji', false, 1,
            '{"headline":"titulo-materia","news_image":"news-image","visual_title":"titulo-png","sponsor_1":"patrocinador-2"}'::jsonb
        ),
        (
            'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid,
            'reels', 'default', 'individual', '5wtiafeuc52hi', false, NULL, '{}'::jsonb
        ),
        (
            'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid,
            'story', 'default', 'story', 'x3djtbqorrtqc', false, 2,
            '{"headline":"titulo-materia","visual_title":"titulo-png","sponsor_1":"patrocinador-1","sponsor_2":"patrocinador-2"}'::jsonb
        ),
        (
            'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid,
            'reels', 'default', 'aparecida', '91gsgmxj1irqh', false, NULL, '{}'::jsonb
        )
    ON CONFLICT (cliente_id, content_type, visual_model) DO NOTHING;

    SELECT count(*)::integer
    INTO v_new_master_count
    FROM ap.master_render_configs AS c
    JOIN (VALUES
        ('feed', 'individual', '4e7pghwb4beji'),
        ('reels', 'individual', '5wtiafeuc52hi'),
        ('story', 'story', 'x3djtbqorrtqc'),
        ('reels', 'aparecida', '91gsgmxj1irqh')
    ) AS expected(content_type, visual_model, template_uuid)
      ON expected.content_type = c.content_type
     AND expected.visual_model = c.visual_model
     AND expected.template_uuid = c.master_template_uuid
    WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
      AND NOT c.enabled;

    IF v_new_master_count <> 4 THEN
        RAISE EXCEPTION
            'AUTOPUBLISHER_NEW_MASTER_SET_INVALID expected=4 actual=%',
            v_new_master_count
            USING ERRCODE = '23514';
    END IF;
END;
$tenant_catalog$;
