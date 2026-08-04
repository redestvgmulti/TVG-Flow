-- AutoPublisher territorial administration: additive base schema.
--
-- This migration does not read or write candidate_news, render snapshots,
-- templates, Placid configuration, sponsor rotation state or publication data.
-- The feature is tenant-scoped and disabled by default.

CREATE OR REPLACE FUNCTION ap.normalize_territorial_name(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
    SELECT lower(
        regexp_replace(
            btrim(COALESCE(p_value, '')),
            '[[:space:]]+',
            ' ',
            'g'
        )
    );
$function$;

COMMENT ON FUNCTION ap.normalize_territorial_name(text) IS
    'Normalizes case and redundant whitespace for tenant-scoped region/city uniqueness.';

-- Composite ownership keys let every new foreign key prove tenant equality in
-- the database instead of trusting a cliente_id supplied by the browser.
DO $constraint$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'visual_titles_cliente_id_id_key'
          AND conrelid = 'ap.visual_titles'::regclass
    ) THEN
        ALTER TABLE ap.visual_titles
            ADD CONSTRAINT visual_titles_cliente_id_id_key
            UNIQUE (cliente_id, id);
    END IF;
END;
$constraint$;

CREATE TABLE ap.territorial_regions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL
        REFERENCES public.clientes (id)
        ON DELETE RESTRICT,
    nome text NOT NULL,
    slug text NOT NULL,
    asset_bucket text NOT NULL,
    asset_path text NOT NULL,
    asset_version text NOT NULL,
    sha256 text NOT NULL,
    asset_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    ativo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT territorial_regions_cliente_slug_key
        UNIQUE (cliente_id, slug),
    CONSTRAINT territorial_regions_cliente_id_key
        UNIQUE (cliente_id, id),
    CONSTRAINT territorial_regions_nome_nonempty
        CHECK (length(ap.normalize_territorial_name(nome)) > 0),
    CONSTRAINT territorial_regions_slug_normalized
        CHECK (
            slug = lower(btrim(slug))
            AND slug ~ '^[a-z0-9][a-z0-9_-]*$'
        ),
    CONSTRAINT territorial_regions_asset_bucket_nonempty
        CHECK (length(btrim(asset_bucket)) > 0),
    CONSTRAINT territorial_regions_asset_path_nonempty
        CHECK (length(btrim(asset_path)) > 0),
    CONSTRAINT territorial_regions_asset_version_nonempty
        CHECK (length(btrim(asset_version)) > 0),
    CONSTRAINT territorial_regions_sha256_valid
        CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT territorial_regions_asset_metadata_object
        CHECK (jsonb_typeof(asset_metadata) = 'object')
);

CREATE UNIQUE INDEX uq_territorial_regions_cliente_normalized_name
    ON ap.territorial_regions (
        cliente_id,
        ap.normalize_territorial_name(nome)
    );

CREATE INDEX idx_territorial_regions_cliente_status_name
    ON ap.territorial_regions (cliente_id, ativo, nome);

CREATE TABLE ap.territorial_cities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL
        REFERENCES public.clientes (id)
        ON DELETE RESTRICT,
    region_id uuid NOT NULL,
    nome text NOT NULL,
    slug text NOT NULL,
    asset_bucket text NOT NULL,
    asset_path text NOT NULL,
    asset_version text NOT NULL,
    sha256 text NOT NULL,
    asset_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    visual_title_id uuid NOT NULL,
    ativo boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT territorial_cities_cliente_slug_key
        UNIQUE (cliente_id, slug),
    CONSTRAINT territorial_cities_cliente_id_key
        UNIQUE (cliente_id, id),
    CONSTRAINT territorial_cities_visual_title_key
        UNIQUE (visual_title_id),
    CONSTRAINT territorial_cities_region_owner_fkey
        FOREIGN KEY (cliente_id, region_id)
        REFERENCES ap.territorial_regions (cliente_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT territorial_cities_visual_title_owner_fkey
        FOREIGN KEY (cliente_id, visual_title_id)
        REFERENCES ap.visual_titles (cliente_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT territorial_cities_nome_nonempty
        CHECK (length(ap.normalize_territorial_name(nome)) > 0),
    CONSTRAINT territorial_cities_slug_normalized
        CHECK (
            slug = lower(btrim(slug))
            AND slug ~ '^[a-z0-9][a-z0-9_-]*$'
        ),
    CONSTRAINT territorial_cities_asset_bucket_nonempty
        CHECK (length(btrim(asset_bucket)) > 0),
    CONSTRAINT territorial_cities_asset_path_nonempty
        CHECK (length(btrim(asset_path)) > 0),
    CONSTRAINT territorial_cities_asset_version_nonempty
        CHECK (length(btrim(asset_version)) > 0),
    CONSTRAINT territorial_cities_sha256_valid
        CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT territorial_cities_asset_metadata_object
        CHECK (jsonb_typeof(asset_metadata) = 'object')
);

CREATE UNIQUE INDEX uq_territorial_cities_cliente_normalized_name
    ON ap.territorial_cities (
        cliente_id,
        ap.normalize_territorial_name(nome)
    );

CREATE INDEX idx_territorial_cities_region_status_name
    ON ap.territorial_cities (cliente_id, region_id, ativo, nome);

-- Existing tenants remain on the current UI until explicitly enabled.
ALTER TABLE ap.system_config
    ADD COLUMN IF NOT EXISTS territorial_admin_enabled boolean
    NOT NULL DEFAULT false;

COMMENT ON COLUMN ap.system_config.territorial_admin_enabled IS
    'Tenant feature flag for the additive Regions/Cities administration UI. Disabled by default.';
COMMENT ON TABLE ap.territorial_regions IS
    'Tenant-scoped administrative regions. Archival uses ativo=false; rows are never deleted by the UI.';
COMMENT ON TABLE ap.territorial_cities IS
    'Tenant-scoped cities linked one-to-one to an automatically managed visual title.';
COMMENT ON COLUMN ap.territorial_regions.asset_metadata IS
    'Non-secret metadata for the immutable PNG asset, such as original/final dimensions and file name.';
COMMENT ON COLUMN ap.territorial_cities.asset_metadata IS
    'Non-secret metadata for the immutable PNG asset shared with the linked visual title.';

CREATE TRIGGER trg_ap_territorial_regions_updated_at
    BEFORE UPDATE ON ap.territorial_regions
    FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();

CREATE TRIGGER trg_ap_territorial_cities_updated_at
    BEFORE UPDATE ON ap.territorial_cities
    FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();
