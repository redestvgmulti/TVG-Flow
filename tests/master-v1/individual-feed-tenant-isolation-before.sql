-- Fixture executed after the visual catalog migration and before the real
-- enablement SQL, always inside an outer transaction that is rolled back.
INSERT INTO public.clientes (id, nome)
VALUES (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
    'AutoPublisher tenant isolation fixture'
)
ON CONFLICT (id) DO NOTHING;

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
VALUES (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
    'feed',
    'default',
    'individual',
    '4e7pghwb4beji',
    false,
    1,
    '{"headline":"titulo-materia","news_image":"news-image","visual_title":"titulo-png","sponsor_1":"patrocinador-2"}'::jsonb
)
ON CONFLICT (cliente_id, content_type, visual_model) DO UPDATE
SET master_template_uuid = EXCLUDED.master_template_uuid,
    enabled = false,
    sponsor_count = EXCLUDED.sponsor_count,
    layer_map = EXCLUDED.layer_map;

UPDATE ap.master_render_configs AS c
SET enabled = false
WHERE c.cliente_id = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'::uuid
  AND c.content_type = 'feed'
  AND c.visual_model = 'individual'
  AND c.master_template_uuid = '4e7pghwb4beji';
