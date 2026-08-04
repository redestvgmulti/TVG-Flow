-- Many-to-many administrative association between territorial regions and the
-- existing render sponsor catalog. This does not participate in rotation yet.

CREATE TABLE ap.territorial_region_sponsors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL
        REFERENCES public.clientes (id)
        ON DELETE RESTRICT,
    region_id uuid NOT NULL,
    sponsor_id uuid NOT NULL,
    ativo boolean NOT NULL DEFAULT true,
    removed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT territorial_region_sponsors_owner_unique
        UNIQUE (cliente_id, region_id, sponsor_id),
    CONSTRAINT territorial_region_sponsors_region_owner_fkey
        FOREIGN KEY (cliente_id, region_id)
        REFERENCES ap.territorial_regions (cliente_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT territorial_region_sponsors_sponsor_owner_fkey
        FOREIGN KEY (cliente_id, sponsor_id)
        REFERENCES ap.render_sponsors (cliente_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT territorial_region_sponsors_removed_state_check
        CHECK (
            (ativo AND removed_at IS NULL)
            OR (NOT ativo)
        )
);

CREATE INDEX idx_territorial_region_sponsors_region_active
    ON ap.territorial_region_sponsors (cliente_id, region_id, sponsor_id)
    WHERE ativo;

CREATE INDEX idx_territorial_region_sponsors_sponsor
    ON ap.territorial_region_sponsors (cliente_id, sponsor_id);

CREATE TRIGGER trg_ap_territorial_region_sponsors_updated_at
    BEFORE UPDATE ON ap.territorial_region_sponsors
    FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();

COMMENT ON TABLE ap.territorial_region_sponsors IS
    'Administrative region/sponsor associations retained independently from the existing global rotation.';
COMMENT ON COLUMN ap.territorial_region_sponsors.removed_at IS
    'Timestamp of administrative removal; the sponsor and other region links remain untouched.';
