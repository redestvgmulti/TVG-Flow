-- Rename the visual model 'misto' to 'tvg_img'.
--
-- The product exposes exactly two visual models — TVG and TVG + IMG — and the
-- internal slugs become 'tvg' and 'tvg_img'. Only the master matrix is renamed:
--
--   feed  + tvg      → mzszfje7xdh6l → 2 patrocinadores
--   reels + tvg      → xcxtk9tt7syfd → 2 patrocinadores
--   feed  + tvg_img  → 3pm4re4blrizh → 1 patrocinador
--   reels + tvg_img  → rrbcykdqcrqae → 1 patrocinador
--
-- Scope and guarantees:
--   * additive and defensive: safe to re-run, and a no-op once applied;
--   * ap.candidate_news is NOT touched — historical snapshots keep the slug
--     they were frozen with, and the renderer is visual-model agnostic (it
--     drives off sponsor_count + layer_map + the snapshot UUID), so those
--     matérias stay renderable and their retries stay deterministic;
--   * master_template_uuid and layer_map are never written;
--   * `enabled` is preserved exactly as it is — this migration enables nothing;
--   * the (cliente_id, content_type, visual_model) uniqueness is re-asserted.
--
-- DEPLOY ORDER — this migration is phase 2 of a four-phase rollout. It must not
-- run before the transitional generator (phase 1) is live, because that build is
-- what keeps a client addressable while the slug is in motion. See
-- docs/rollout-tvg-img.md.
--
-- ROLLBACK: forward-only by default. A pre-written, contract-tested reverse
-- script exists at supabase/rollback/20260727120000_rollback_rename_visual_-
-- model_tvg_img_to_misto.sql. It lives outside supabase/migrations on purpose,
-- so no tooling can apply it by accident, and it is only valid while the
-- transitional generator is still deployed.
--
-- No SQL function or RPC validates visual_model: ap.create_candidate_with_-
-- sponsors receives the already-resolved snapshot base and never inspects the
-- slug. The CHECK constraint below is therefore the only SQL-side validator,
-- and it is the only one that needs updating.
--
-- Every statement, including the index and comment DDL, runs inside the guarded
-- block: on a database without the table the migration must be a clean no-op and
-- must not leave partial objects behind.

DO $migration$
DECLARE
    v_collisions integer;
    v_leftover integer;
BEGIN
    IF to_regclass('ap.master_render_configs') IS NULL THEN
        RAISE NOTICE
            'ap.master_render_configs is absent; nothing to rename.';
        RETURN;
    END IF;

    -- A rename must never merge two rows. If a client somehow already owns both
    -- the legacy and the new row for the same format, stop and let an operator
    -- reconcile it: silently dropping one would lose a master.
    SELECT count(*)
    INTO v_collisions
    FROM ap.master_render_configs legacy
    WHERE legacy.visual_model = 'misto'
      AND EXISTS (
          SELECT 1
          FROM ap.master_render_configs target
          WHERE target.cliente_id = legacy.cliente_id
            AND target.content_type = legacy.content_type
            AND target.visual_model = 'tvg_img'
      );

    IF v_collisions > 0 THEN
        RAISE EXCEPTION
            'MASTER_RENDER_CONFIG_VISUAL_MODEL_RENAME_COLLISION count=%',
            v_collisions
            USING ERRCODE = '23505',
                  HINT =
                    'A client already has both misto and tvg_img for the same '
                    'content_type. Reconcile the duplicate before rerunning.';
    END IF;

    -- Widen the CHECK first so the UPDATE below cannot violate it mid-flight.
    ALTER TABLE ap.master_render_configs
        DROP CONSTRAINT IF EXISTS master_render_configs_visual_model_check;

    -- Slug only. enabled, master_template_uuid and layer_map are untouched.
    UPDATE ap.master_render_configs
    SET visual_model = 'tvg_img'
    WHERE visual_model = 'misto';

    SELECT count(*)
    INTO v_leftover
    FROM ap.master_render_configs
    WHERE visual_model NOT IN ('tvg', 'tvg_img');

    IF v_leftover > 0 THEN
        RAISE EXCEPTION
            'MASTER_RENDER_CONFIG_VISUAL_MODEL_UNKNOWN count=%',
            v_leftover
            USING ERRCODE = '23514',
                  HINT =
                    'Rows carry a visual_model outside (tvg, tvg_img). '
                    'Reconcile them before rerunning.';
    END IF;

    ALTER TABLE ap.master_render_configs
        ADD CONSTRAINT master_render_configs_visual_model_check
        CHECK (visual_model IN ('tvg', 'tvg_img'));

    -- Re-assert the identity invariant. Guarded, so both are no-ops when
    -- 20260725120000 already created them.
    EXECUTE $ddl$
        CREATE UNIQUE INDEX IF NOT EXISTS uq_master_render_config_per_visual_model
            ON ap.master_render_configs (cliente_id, content_type, visual_model)
    $ddl$;

    EXECUTE $ddl$
        CREATE INDEX IF NOT EXISTS idx_master_render_configs_visual_model_lookup
            ON ap.master_render_configs (cliente_id, content_type, visual_model)
            WHERE enabled
    $ddl$;

    EXECUTE $ddl$
        COMMENT ON COLUMN ap.master_render_configs.visual_model IS
            'Visual model (tvg | tvg_img). Together with content_type it '
            'selects the fixed Placid template and implies the sponsor count '
            '(tvg=2, tvg_img=1). The historical slug ''misto'' was renamed to '
            '''tvg_img'' by 20260727120000; it may still appear inside frozen '
            'render snapshots of past matérias, which are never rewritten.'
    $ddl$;

    EXECUTE $ddl$
        COMMENT ON INDEX ap.uq_master_render_config_per_visual_model IS
            'At most one master configuration per client, content type and '
            'visual model — the widened form of the one-master-per-format '
            'invariant.'
    $ddl$;
END;
$migration$;
