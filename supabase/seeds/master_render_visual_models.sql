-- ============================================================================
-- Seed the four FIXED Placid templates per client (visual model × format).
-- ============================================================================
-- The operator never configures templates, UUIDs or layers in the daily
-- routine. These four rows ARE the fixed configuration. Run once per client:
--
--   psql ... -v cliente_id=<uuid> -f supabase/seeds/master_render_visual_models.sql
--
-- Re-runnable: ON CONFLICT updates in place.
--
-- Matrix (sponsor count is implied by the model, never stored here and never
-- chosen by the operator):
--   feed  + tvg    → mzszfje7xdh6l → 2 patrocinadores
--   reels + tvg    → xcxtk9tt7syfd → 2 patrocinadores
--   feed  + misto  → 3pm4re4blrizh → 1 patrocinador
--   reels + misto  → rrbcykdqcrqae → 1 patrocinador
--
-- Fixed layer map (identical for every client; never exposed in the UI):
--   headline     → "titulo-materia"   (article headline TEXT)
--   news_image   → "news-image"       (feed only; background photo)
--   visual_title → "titulo-png"       (the selected selo PNG)
--   sponsor_1    → "patrocinador-1"   (bottom-right; always the 1st sponsor)
--   sponsor_2    → "patrocinador-2"   (center; only populated by the tvg model)
--
-- news_image is required for feed by the renderer contract
-- (renderContract.validateLayerMap) and forbidden for reels.
--
-- template_set stays NULL here: it is not part of the master identity. The
-- sponsor rotation scope is 'default' and is shared by both visual models, so
-- each sponsor is registered ONCE (Patrocinadores tab) and rotates across TVG
-- and Misto within a format.
-- ============================================================================

\if :{?cliente_id}
\else
\echo 'ERROR: run with -v cliente_id=<uuid>'
\quit 1
\endif

\set feed_layers  '{"headline":"titulo-materia","news_image":"news-image","visual_title":"titulo-png","sponsor_1":"patrocinador-1","sponsor_2":"patrocinador-2"}'
\set reels_layers '{"headline":"titulo-materia","visual_title":"titulo-png","sponsor_1":"patrocinador-1","sponsor_2":"patrocinador-2"}'

INSERT INTO ap.master_render_configs
    (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
VALUES
    -- FEED
    (:'cliente_id', 'feed',  'tvg',   'mzszfje7xdh6l', true, :'feed_layers'::jsonb),
    (:'cliente_id', 'feed',  'misto', '3pm4re4blrizh', true, :'feed_layers'::jsonb),
    -- REELS
    (:'cliente_id', 'reels', 'tvg',   'xcxtk9tt7syfd', true, :'reels_layers'::jsonb),
    (:'cliente_id', 'reels', 'misto', 'rrbcykdqcrqae', true, :'reels_layers'::jsonb)
ON CONFLICT (cliente_id, content_type, visual_model)
DO UPDATE SET
    master_template_uuid = EXCLUDED.master_template_uuid,
    enabled = EXCLUDED.enabled,
    layer_map = EXCLUDED.layer_map;

-- Ensure the kill switch is off so the master path is live.
INSERT INTO ap.master_render_controls (cliente_id, kill_switch)
VALUES (:'cliente_id', false)
ON CONFLICT (cliente_id) DO UPDATE SET kill_switch = false;
