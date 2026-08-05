-- Regional sponsor rotation with explicit reservation lifecycle.
--
-- This is deliberately separate from ap.render_sponsor_rotation_state:
-- the live rotation consumes its cursor during candidate creation and requires
-- a complete pool. Changing it would alter current Feed/Reels behavior.

CREATE OR REPLACE FUNCTION ap.uuid_array_is_unique(p_values uuid[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
    SELECT cardinality(COALESCE(p_values, '{}'::uuid[])) = (
        SELECT count(DISTINCT value)
        FROM unnest(COALESCE(p_values, '{}'::uuid[])) AS value
    );
$function$;

CREATE TABLE ap.territorial_sponsor_rotation_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL
        REFERENCES public.clientes (id)
        ON DELETE RESTRICT,
    region_id uuid NOT NULL,
    content_type text NOT NULL,
    current_cycle bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT territorial_sponsor_rotation_state_scope_key
        UNIQUE (cliente_id, region_id, content_type),
    CONSTRAINT territorial_sponsor_rotation_state_owner_key
        UNIQUE (cliente_id, id),
    CONSTRAINT territorial_sponsor_rotation_state_region_owner_fkey
        FOREIGN KEY (cliente_id, region_id)
        REFERENCES ap.territorial_regions (cliente_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT territorial_sponsor_rotation_state_content_type_check
        CHECK (content_type IN ('feed', 'reels', 'story')),
    CONSTRAINT territorial_sponsor_rotation_state_cycle_check
        CHECK (current_cycle >= 1)
);

CREATE TRIGGER trg_ap_territorial_sponsor_rotation_state_updated_at
    BEFORE UPDATE ON ap.territorial_sponsor_rotation_state
    FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();

CREATE TABLE ap.territorial_sponsor_reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL
        REFERENCES public.clientes (id)
        ON DELETE RESTRICT,
    region_id uuid NOT NULL,
    candidate_id uuid,
    content_type text NOT NULL,
    composer_mode text NOT NULL,
    cycle bigint NOT NULL,
    selected_sponsor_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
    status text NOT NULL DEFAULT 'reserved',
    reserved_at timestamptz NOT NULL DEFAULT now(),
    committed_at timestamptz,
    released_at timestamptz,
    release_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT territorial_sponsor_reservations_owner_key
        UNIQUE (cliente_id, id),
    CONSTRAINT territorial_sponsor_reservations_candidate_key
        UNIQUE (candidate_id),
    CONSTRAINT territorial_sponsor_reservations_region_owner_fkey
        FOREIGN KEY (cliente_id, region_id)
        REFERENCES ap.territorial_regions (cliente_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT territorial_sponsor_reservations_candidate_fkey
        FOREIGN KEY (candidate_id)
        REFERENCES ap.candidate_news (id)
        ON DELETE SET NULL
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT territorial_sponsor_reservations_content_type_check
        CHECK (content_type IN ('feed', 'reels', 'story')),
    CONSTRAINT territorial_sponsor_reservations_mode_check
        CHECK (composer_mode IN ('editorial', 'cities')),
    CONSTRAINT territorial_sponsor_reservations_cycle_check
        CHECK (cycle >= 1),
    CONSTRAINT territorial_sponsor_reservations_sponsor_count_check
        CHECK (cardinality(selected_sponsor_ids) BETWEEN 0 AND 2),
    CONSTRAINT territorial_sponsor_reservations_sponsor_unique_check
        CHECK (ap.uuid_array_is_unique(selected_sponsor_ids)),
    CONSTRAINT territorial_sponsor_reservations_status_check
        CHECK (status IN ('reserved', 'committed', 'released')),
    CONSTRAINT territorial_sponsor_reservations_timestamps_check
        CHECK (
            (status = 'reserved' AND committed_at IS NULL AND released_at IS NULL)
            OR
            (status = 'committed' AND committed_at IS NOT NULL AND released_at IS NULL)
            OR
            (status = 'released' AND committed_at IS NULL AND released_at IS NOT NULL)
        )
);

CREATE INDEX idx_territorial_sponsor_reservations_rotation
    ON ap.territorial_sponsor_reservations (
        cliente_id,
        region_id,
        content_type,
        cycle,
        status
    );

CREATE TRIGGER trg_ap_territorial_sponsor_reservations_updated_at
    BEFORE UPDATE ON ap.territorial_sponsor_reservations
    FOR EACH ROW EXECUTE FUNCTION ap.set_updated_at();

ALTER TABLE ap.candidate_news
    ADD COLUMN IF NOT EXISTS territorial_reservation_id uuid;

ALTER TABLE ap.candidate_news
    DROP CONSTRAINT IF EXISTS candidate_news_territorial_reservation_fkey;
ALTER TABLE ap.candidate_news
    ADD CONSTRAINT candidate_news_territorial_reservation_fkey
    FOREIGN KEY (territorial_reservation_id)
    REFERENCES ap.territorial_sponsor_reservations (id)
    ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX uq_candidate_news_territorial_reservation
    ON ap.candidate_news (territorial_reservation_id)
    WHERE territorial_reservation_id IS NOT NULL;

COMMENT ON TABLE ap.territorial_sponsor_rotation_state IS
    'Independent cycle per tenant, region and format. Editorial and Cities share the scope.';
COMMENT ON TABLE ap.territorial_sponsor_reservations IS
    'Frozen regional sponsor selections with reserved/committed/released lifecycle.';
COMMENT ON COLUMN ap.candidate_news.territorial_reservation_id IS
    'Optional reservation pointer used only by territorial_composer_v1 automatic modes.';

REVOKE ALL ON FUNCTION ap.uuid_array_is_unique(uuid[])
FROM PUBLIC, anon;
