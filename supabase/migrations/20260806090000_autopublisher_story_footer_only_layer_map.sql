-- The visually inspected Stories template has only the three lower image slots.
-- Keep this correction additive: historical snapshots are not rewritten and
-- every new composer configuration remains tenant-scoped and fail-closed.

CREATE OR REPLACE FUNCTION ap.is_valid_territorial_layer_map(
    p_content_type text,
    p_layer_map jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
    SELECT
        p_content_type IN ('feed', 'reels', 'story')
        AND jsonb_typeof(p_layer_map) = 'object'
        AND NOT EXISTS (
            SELECT 1 FROM jsonb_each_text(p_layer_map) AS entry
            WHERE length(btrim(entry.value)) = 0
        )
        AND (
            (p_content_type = 'feed'
             AND NOT EXISTS (
                 SELECT 1 FROM jsonb_object_keys(p_layer_map) AS key_name
                 WHERE key_name NOT IN ('headline', 'news_image', 'visual_title', 'footer_slot_1', 'footer_slot_2', 'footer_slot_3')
             )
             AND (p_layer_map ? 'headline')
             AND (p_layer_map ? 'news_image')
             AND (p_layer_map ? 'visual_title'))
            OR
            (p_content_type = 'reels'
             AND NOT EXISTS (
                 SELECT 1 FROM jsonb_object_keys(p_layer_map) AS key_name
                 WHERE key_name NOT IN ('headline', 'visual_title', 'footer_slot_1', 'footer_slot_2', 'footer_slot_3')
             )
             AND (p_layer_map ? 'headline')
             AND (p_layer_map ? 'visual_title'))
            OR
            (p_content_type = 'story'
             AND NOT EXISTS (
                 SELECT 1 FROM jsonb_object_keys(p_layer_map) AS key_name
                 WHERE key_name NOT IN ('footer_slot_1', 'footer_slot_2', 'footer_slot_3')
             ))
        )
        AND (p_layer_map ? 'footer_slot_1')
        AND (p_layer_map ? 'footer_slot_2')
        AND (p_layer_map ? 'footer_slot_3')
        AND (
            SELECT count(*) = count(DISTINCT entry.value)
            FROM jsonb_each_text(p_layer_map) AS entry
        );
$function$;

COMMENT ON FUNCTION ap.is_valid_territorial_layer_map(text, jsonb) IS
    'Validates locally enforced tenant-scoped maps: Feed has title/image/seal/three footers; Reels has title/seal/three footers; Story has exactly three footers.';
