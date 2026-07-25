-- Product architecture: the six fixed Placid templates are addressed by
-- publication vehicle ("veiculo") x format. Each (cliente, content_type,
-- template_set) row of ap.master_render_configs is one fixed template, where
-- template_set carries the vehicle slug (tvg_itumbiara | tvg | itumbiara).
--
-- 20260724000942 collapsed the master identity to (cliente, content_type) to
-- enforce a single master per format. That is now intentionally reverted: a
-- client needs up to three masters per format, one per vehicle. Sponsor and
-- template rotation are already scoped by (cliente, template_set, content_type),
-- so the vehicle simply reuses that existing scope -- no new column is needed.
--
-- Replay-safe: only drops/creates indexes guarded by IF [NOT] EXISTS.

DO $migration$
DECLARE
    v_scope_collision integer;
BEGIN
    -- Guard: restoring the wider key must not silently merge rows that already
    -- collide on the narrower (cliente, content_type, template_set) scope.
    SELECT count(*)
    INTO v_scope_collision
    FROM (
        SELECT cliente_id, content_type, COALESCE(template_set, '')
        FROM ap.master_render_configs
        GROUP BY cliente_id, content_type, COALESCE(template_set, '')
        HAVING count(*) > 1
    ) collisions;

    IF v_scope_collision > 0 THEN
        RAISE EXCEPTION
            'MASTER_RENDER_CONFIG_SCOPE_COLLISIONS count=%', v_scope_collision
            USING ERRCODE = '23505',
                  HINT = 'Reconcile duplicate vehicle rows before rerunning.';
    END IF;
END;
$migration$;

DROP INDEX IF EXISTS ap.uq_master_render_config_per_format;
DROP INDEX IF EXISTS ap.idx_master_render_configs_enabled_lookup;

-- One master per (cliente, format, vehicle). COALESCE keeps legacy rows that
-- predate the vehicle model (template_set IS NULL) uniquely addressable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_render_config_per_vehicle
    ON ap.master_render_configs (cliente_id, content_type, COALESCE(template_set, ''));

CREATE INDEX IF NOT EXISTS idx_master_render_configs_vehicle_lookup
    ON ap.master_render_configs (cliente_id, content_type, template_set)
    WHERE enabled;

COMMENT ON COLUMN ap.master_render_configs.template_set IS
    'Publication vehicle slug (tvg_itumbiara | tvg | itumbiara). Selects the '
    'fixed Placid template together with content_type, and is the rotation '
    'scope shared with ap.render_sponsor_scope_memberships. NULL only for '
    'legacy pre-vehicle rows.';

COMMENT ON INDEX ap.uq_master_render_config_per_vehicle IS
    'At most one master configuration per client, content type and vehicle.';
