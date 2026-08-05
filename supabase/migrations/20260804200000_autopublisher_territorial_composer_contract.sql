-- AutoPublisher territorial composer: additive feature flag, versioned
-- template contract and candidate compatibility.
--
-- Nothing is enabled by this migration. Existing candidates, master_v1
-- configurations and legacy render paths remain valid and unchanged.

CREATE TABLE ap.territorial_composer_features (
    cliente_id uuid PRIMARY KEY
        REFERENCES public.clientes (id)
        ON DELETE RESTRICT,
    enabled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ap.territorial_composer_features IS
    'Tenant-scoped gate for territorial_composer_v1. An absent row is disabled.';
COMMENT ON COLUMN ap.territorial_composer_features.enabled IS
    'Enables only the new composer for this tenant; it does not enable territorial administration.';

CREATE TRIGGER trg_ap_territorial_composer_features_updated_at
    BEFORE UPDATE ON ap.territorial_composer_features
    FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();

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
            SELECT 1
            FROM jsonb_object_keys(p_layer_map) AS key_name
            WHERE key_name NOT IN (
                'headline',
                'tag',
                'news_image',
                'visual_title',
                'footer_slot_1',
                'footer_slot_2',
                'footer_slot_3'
            )
        )
        AND NOT EXISTS (
            SELECT 1
            FROM jsonb_each_text(p_layer_map) AS entry
            WHERE length(btrim(entry.value)) = 0
        )
        AND (p_layer_map ? 'headline')
        AND (p_layer_map ? 'footer_slot_1')
        AND (p_layer_map ? 'footer_slot_2')
        AND (p_layer_map ? 'footer_slot_3')
        AND (
            (
                p_content_type IN ('feed', 'reels')
                AND (p_layer_map ? 'visual_title')
            )
            OR
            (
                p_content_type = 'story'
                AND NOT (p_layer_map ? 'visual_title')
            )
        )
        AND (
            p_content_type = 'feed'
            OR NOT (p_layer_map ? 'news_image')
        )
        AND (
            p_content_type = 'feed'
            OR NOT (p_layer_map ? 'tag')
        )
        AND (
            SELECT count(*) = count(DISTINCT entry.value)
            FROM jsonb_each_text(p_layer_map) AS entry
        );
$function$;

COMMENT ON FUNCTION ap.is_valid_territorial_layer_map(text, jsonb) IS
    'Validates the single logical-to-physical layer map used by territorial_composer_v1.';

CREATE TABLE ap.territorial_composer_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL
        REFERENCES public.clientes (id)
        ON DELETE RESTRICT,
    content_type text NOT NULL,
    master_template_uuid text NOT NULL,
    layer_map jsonb NOT NULL,
    ativo boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT territorial_composer_templates_owner_key
        UNIQUE (cliente_id, id),
    CONSTRAINT territorial_composer_templates_content_type_check
        CHECK (content_type IN ('feed', 'reels', 'story')),
    CONSTRAINT territorial_composer_templates_uuid_check
        CHECK (
            length(btrim(master_template_uuid)) BETWEEN 6 AND 128
            AND master_template_uuid ~ '^[A-Za-z0-9_-]+$'
        ),
    CONSTRAINT territorial_composer_templates_layer_map_check
        CHECK (
            ap.is_valid_territorial_layer_map(content_type, layer_map)
        )
);

CREATE UNIQUE INDEX uq_territorial_composer_template_active_format
    ON ap.territorial_composer_templates (cliente_id, content_type)
    WHERE ativo;

CREATE INDEX idx_territorial_composer_templates_client_format
    ON ap.territorial_composer_templates (
        cliente_id,
        content_type,
        created_at DESC
    );

CREATE TRIGGER trg_ap_territorial_composer_templates_updated_at
    BEFORE UPDATE ON ap.territorial_composer_templates
    FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();

COMMENT ON TABLE ap.territorial_composer_templates IS
    'Versionable composer templates; at most one active row exists per tenant and format.';
COMMENT ON COLUMN ap.territorial_composer_templates.layer_map IS
    'Frozen logical map. Story intentionally forbids visual_title.';

-- Preserve every content type already accepted by the repository while adding
-- Story. Existing Feed/Reels/carousel/sponsored rows are not rewritten.
ALTER TABLE ap.candidate_news
    DROP CONSTRAINT IF EXISTS candidate_news_content_type_check;
ALTER TABLE ap.candidate_news
    ADD CONSTRAINT candidate_news_content_type_check
    CHECK (
        content_type IN (
            'feed',
            'reels',
            'story',
            'carousel',
            'sponsored'
        )
    );

ALTER TABLE ap.candidate_news
    DROP CONSTRAINT IF EXISTS candidate_news_render_contract_version_check;
ALTER TABLE ap.candidate_news
    ADD CONSTRAINT candidate_news_render_contract_version_check
    CHECK (
        render_contract_version IN (
            'legacy',
            'master_v1',
            'territorial_composer_v1'
        )
    );

-- These lifecycle columns already belong to the renderer contract in an older
-- migration. IF NOT EXISTS keeps this migration safe for environments whose
-- historical ledger was applied incompletely, without rewriting any row.
ALTER TABLE ap.candidate_news
    ADD COLUMN IF NOT EXISTS context_tag text,
    ADD COLUMN IF NOT EXISTS render_started_at timestamptz,
    ADD COLUMN IF NOT EXISTS render_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS error_log text;

CREATE INDEX IF NOT EXISTS idx_candidate_news_territorial_contract
    ON ap.candidate_news (
        cliente_id,
        content_type,
        render_contract_version
    )
    WHERE render_contract_version = 'territorial_composer_v1';

REVOKE ALL ON FUNCTION ap.is_valid_territorial_layer_map(text, jsonb)
FROM PUBLIC, anon;
