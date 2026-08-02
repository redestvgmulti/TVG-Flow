-- Fixture and immutable row snapshots captured before the structural migration.
-- Execute only inside an outer transaction that will be rolled back.
INSERT INTO public.clientes (id, nome)
VALUES (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
    'AutoPublisher structural tenant B'
)
ON CONFLICT (id) DO NOTHING;

-- The current local baseline already rejects new misto rows. Drop only the
-- CHECK inside this rollback-only fixture so an older tenant row can be
-- represented before the structural migration reinstates the widened CHECK.
ALTER TABLE ap.master_render_configs
    DROP CONSTRAINT IF EXISTS master_render_configs_visual_model_check;

INSERT INTO ap.master_render_configs (
    cliente_id,
    content_type,
    template_set,
    master_template_uuid,
    enabled,
    layer_map,
    visual_model
)
VALUES (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
    'feed',
    'default',
    'tenant-b-misto-template',
    true,
    '{"headline":"tenant-b-headline"}'::jsonb,
    'misto'
)
ON CONFLICT (cliente_id, content_type, visual_model) DO UPDATE
SET template_set = EXCLUDED.template_set,
    master_template_uuid = EXCLUDED.master_template_uuid,
    enabled = EXCLUDED.enabled,
    layer_map = EXCLUDED.layer_map;

CREATE TEMP TABLE master_rows_before ON COMMIT DROP AS
SELECT to_jsonb(c) - 'sponsor_count' AS row_data
FROM ap.master_render_configs AS c;

CREATE TEMP TABLE visual_title_rows_before ON COMMIT DROP AS
SELECT to_jsonb(t) AS row_data
FROM ap.visual_titles AS t;

CREATE TEMP TABLE sponsor_membership_rows_before ON COMMIT DROP AS
SELECT to_jsonb(m) AS row_data
FROM ap.render_sponsor_scope_memberships AS m;

CREATE TEMP TABLE sponsor_cursor_rows_before ON COMMIT DROP AS
SELECT to_jsonb(state) AS row_data
FROM ap.render_sponsor_rotation_state AS state;

CREATE TEMP TABLE candidate_rows_before ON COMMIT DROP AS
SELECT to_jsonb(news) AS row_data
FROM ap.candidate_news AS news;

CREATE TEMP TABLE operational_enabled_before ON COMMIT DROP AS
SELECT c.id, c.enabled
FROM ap.master_render_configs AS c
WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
  AND c.master_template_uuid IN (
      'mzszfje7xdh6l',
      'xcxtk9tt7syfd',
      '3pm4re4blrizh',
      'rrbcykdqcrqae'
  );

DO $fixture$
BEGIN
    IF (SELECT count(*) FROM operational_enabled_before) <> 4 THEN
        RAISE EXCEPTION 'OPERATIONAL_MASTER_FIXTURE_INCOMPLETE';
    END IF;
END;
$fixture$;
