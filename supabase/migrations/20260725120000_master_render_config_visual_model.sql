-- Product architecture: the four fixed Placid templates are addressed by
-- visual model ("modelo visual") x format. Each (cliente, content_type,
-- visual_model) row of ap.master_render_configs is one fixed template:
--
--   feed  + tvg    → TVG fixa + 2 patrocinadores dinâmicos
--   reels + tvg    → TVG fixa + 2 patrocinadores dinâmicos
--   feed  + misto  → TVG fixa + Itumbiara fixa + 1 patrocinador
--   reels + misto  → TVG fixa + Itumbiara fixa + 1 patrocinador
--
-- 20260724000942 collapsed the master identity to (cliente, content_type) to
-- enforce a single master per format. That invariant is not removed here: it is
-- WIDENED, because a client needs exactly two masters per format, one per visual
-- model. The unique index still forbids ambiguous masters.
--
-- visual_model gets its own column on purpose. template_set is NOT reused for
-- it: template_set stays the internal sponsor-rotation scope (fixed at
-- 'default'), which TVG and Misto deliberately share so that a sponsor is
-- registered once and rotates across both models within a format. This
-- migration therefore does not touch ap.render_sponsor_rotation_state or
-- ap.render_sponsor_scope_memberships in any way.
--
-- Replay-safe: the backfill is idempotent and every index is guarded.

ALTER TABLE ap.master_render_configs
    ADD COLUMN IF NOT EXISTS visual_model text;

-- Backfill before NOT NULL. Pre-visual-model rows are, by definition, the
-- single master that used to serve the whole format; TVG is the default house
-- model, so they become 'tvg' and stay addressable and enabled.
UPDATE ap.master_render_configs
SET visual_model = 'tvg'
WHERE visual_model IS NULL;

DO $migration$
DECLARE
    v_model_collision integer;
BEGIN
    -- Guard: widening the key must not silently merge rows that already collide
    -- on the wider (cliente, content_type, visual_model) scope.
    SELECT count(*)
    INTO v_model_collision
    FROM (
        SELECT cliente_id, content_type, visual_model
        FROM ap.master_render_configs
        GROUP BY cliente_id, content_type, visual_model
        HAVING count(*) > 1
    ) collisions;

    IF v_model_collision > 0 THEN
        RAISE EXCEPTION
            'MASTER_RENDER_CONFIG_VISUAL_MODEL_COLLISIONS count=%',
            v_model_collision
            USING ERRCODE = '23505',
                  HINT =
                    'Reconcile duplicate visual model rows before rerunning.';
    END IF;
END;
$migration$;

ALTER TABLE ap.master_render_configs
    ALTER COLUMN visual_model SET NOT NULL;

ALTER TABLE ap.master_render_configs
    DROP CONSTRAINT IF EXISTS master_render_configs_visual_model_check;

ALTER TABLE ap.master_render_configs
    ADD CONSTRAINT master_render_configs_visual_model_check
    CHECK (visual_model IN ('tvg', 'misto'));

DROP INDEX IF EXISTS ap.uq_master_render_config_per_format;
DROP INDEX IF EXISTS ap.idx_master_render_configs_enabled_lookup;

-- Defensive: an unreleased local iteration keyed the master on the publication
-- vehicle (template_set). It never reached the migration history, but a
-- developer database may still carry its indexes, and the vehicle unique index
-- would reject two visual models sharing template_set. Dropping it is a no-op
-- everywhere else.
DROP INDEX IF EXISTS ap.uq_master_render_config_per_vehicle;
DROP INDEX IF EXISTS ap.idx_master_render_configs_vehicle_lookup;

-- One master per (cliente, format, visual model): at most four rows per client.
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_render_config_per_visual_model
    ON ap.master_render_configs (cliente_id, content_type, visual_model);

CREATE INDEX IF NOT EXISTS idx_master_render_configs_visual_model_lookup
    ON ap.master_render_configs (cliente_id, content_type, visual_model)
    WHERE enabled;

COMMENT ON COLUMN ap.master_render_configs.visual_model IS
    'Visual model (tvg | misto). Together with content_type it selects the '
    'fixed Placid template and implies the sponsor count (tvg=2, misto=1).';

COMMENT ON COLUMN ap.master_render_configs.template_set IS
    'Deprecated as master identity. Kept only as the internal sponsor rotation '
    'scope (always ''default''), shared by every visual model of a format. '
    'Never use it to carry the visual model.';

COMMENT ON INDEX ap.uq_master_render_config_per_visual_model IS
    'At most one master configuration per client, content type and visual '
    'model — the widened form of the one-master-per-format invariant.';
