-- ============================================================================
-- Seed the six FIXED Placid templates per client (publication vehicle × format).
-- ============================================================================
-- The operator never configures templates, UUIDs or layers in the daily routine.
-- These six rows ARE the fixed configuration. Fill in the six real Placid
-- template UUIDs (from the Placid dashboard / ap.templates) and run once per
-- client (replace :cliente_id). Re-runnable: ON CONFLICT updates in place.
--
-- Vehicle → format → sponsor count (sponsor count is implied, never stored):
--   tvg_itumbiara  → 1 patrocinador   (feed + reels)
--   tvg            → 2 patrocinadores  (feed + reels)
--   itumbiara      → 2 patrocinadores  (feed + reels)
--
-- Fixed layer map (identical for every client; do NOT expose in the UI):
--   headline     → "titulo-materia"   (article headline TEXT)
--   news_image   → "news-image"       (feed only; background photo)
--   visual_title → "titulo-png"       (the selected selo PNG)
--   sponsor_1    → "patrocinador-1"   (bottom-right; always the 1st sponsor)
--   sponsor_2    → "patrocinador-2"   (center; only populated with 2 sponsors)
--
-- After seeding, associate active sponsors to each vehicle scope for the
-- rotation (Patrocinadores tab, or ap.render_sponsor_scope_memberships with
-- template_set = vehicle slug).
-- ============================================================================

\set cliente_id '00000000-0000-0000-0000-000000000000'

-- Reusable fixed layer maps.
\set feed_layers  '{"headline":"titulo-materia","news_image":"news-image","visual_title":"titulo-png","sponsor_1":"patrocinador-1","sponsor_2":"patrocinador-2"}'
\set reels_layers '{"headline":"titulo-materia","visual_title":"titulo-png","sponsor_1":"patrocinador-1","sponsor_2":"patrocinador-2"}'

INSERT INTO ap.master_render_configs
    (cliente_id, content_type, template_set, master_template_uuid, enabled, layer_map)
VALUES
    -- FEED
    (:'cliente_id', 'feed',  'tvg_itumbiara', 'REPLACE_FEED_TVG_ITUMBIARA_UUID', true, :'feed_layers'::jsonb),
    (:'cliente_id', 'feed',  'tvg',           'REPLACE_FEED_TVG_UUID',           true, :'feed_layers'::jsonb),
    (:'cliente_id', 'feed',  'itumbiara',     'REPLACE_FEED_ITUMBIARA_UUID',     true, :'feed_layers'::jsonb),
    -- REELS
    (:'cliente_id', 'reels', 'tvg_itumbiara', 'REPLACE_REELS_TVG_ITUMBIARA_UUID', true, :'reels_layers'::jsonb),
    (:'cliente_id', 'reels', 'tvg',           'REPLACE_REELS_TVG_UUID',           true, :'reels_layers'::jsonb),
    (:'cliente_id', 'reels', 'itumbiara',     'REPLACE_REELS_ITUMBIARA_UUID',     true, :'reels_layers'::jsonb)
ON CONFLICT (cliente_id, content_type, COALESCE(template_set, ''))
DO UPDATE SET
    master_template_uuid = EXCLUDED.master_template_uuid,
    enabled = EXCLUDED.enabled,
    layer_map = EXCLUDED.layer_map;

-- Ensure the kill switch is off so the master path is live.
INSERT INTO ap.master_render_controls (cliente_id, kill_switch)
VALUES (:'cliente_id', false)
ON CONFLICT (cliente_id) DO UPDATE SET kill_switch = false;
