-- REVERSE of 20260727120000 (tvg_img → misto). Written and contract-tested in
-- advance so nobody has to improvise it during an incident.
--
-- ============================================================================
-- READ THIS BEFORE RUNNING IT
-- ============================================================================
-- The default operational posture is FORWARD-ONLY. Reverting the slug is not
-- the normal way to recover from a bad deploy: rolling the frontend and the
-- generator forward is. This script exists for one narrow situation — the
-- rename landed, phase 3/4 has NOT happened yet, and the only way out is to put
-- the database back where the previous release expects it.
--
-- ⚠️ ROLLING BACK THE DATABASE ALONE IS FORBIDDEN.
--
-- The system is only consistent in whole combinations of schema + Edge Function
-- + frontend + environment variable. Reverting the schema while a phase 4
-- (hardened) build is live takes generation down: that build looks the master up
-- as 'tvg_img' only and can no longer address a row stored as 'misto'.
--
-- MANDATORY ORDER — do not reorder:
--   1. unset AP_LEGACY_VISUAL_MODEL_INPUT (or set it to 'accept') and confirm
--      the deployed Edge Function is the transitional build;
--   2. verify a generation still works;
--   3. only then run this script;
--   4. verify again.
--
-- The combination matrix and the full rollout are in docs/rollout-tvg-img.md.
--
-- PRECONDITIONS:
--   1. The transitional generator (phase 1) or an older build must be the one
--      deployed — see the mandatory order above.
--   2. The four fixed UUIDs must still be intact.
--
-- WHAT IT DOES NOT DO:
--   * it does not touch ap.candidate_news — snapshots frozen with 'tvg_img'
--     stay 'tvg_img' and keep rendering, because the renderer never reads the
--     visual model (it drives off sponsor_count + layer_map + snapshot UUID);
--   * it does not change master_template_uuid or layer_map;
--   * it does not change `enabled` — it enables and disables nothing;
--   * it does not drop the widened unique index, which is valid under either
--     slug.
--
-- This file deliberately lives OUTSIDE supabase/migrations so that
-- `supabase db push` / `db reset` can never pick it up. Run it by hand:
--   docker exec -i <db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/rollback/20260727120000_rollback_...sql
-- ============================================================================

DO $rollback$
DECLARE
    v_collisions integer;
    v_leftover integer;
    v_renamed integer;
BEGIN
    IF to_regclass('ap.master_render_configs') IS NULL THEN
        RAISE NOTICE
            'ap.master_render_configs is absent; nothing to roll back.';
        RETURN;
    END IF;

    -- Same guard as the forward migration, mirrored: never merge two rows.
    SELECT count(*)
    INTO v_collisions
    FROM ap.master_render_configs target
    WHERE target.visual_model = 'tvg_img'
      AND EXISTS (
          SELECT 1
          FROM ap.master_render_configs legacy
          WHERE legacy.cliente_id = target.cliente_id
            AND legacy.content_type = target.content_type
            AND legacy.visual_model = 'misto'
      );

    IF v_collisions > 0 THEN
        RAISE EXCEPTION
            'MASTER_RENDER_CONFIG_VISUAL_MODEL_ROLLBACK_COLLISION count=%',
            v_collisions
            USING ERRCODE = '23505',
                  HINT =
                    'A client already has both tvg_img and misto for the same '
                    'content_type. Reconcile the duplicate before rerunning.';
    END IF;

    ALTER TABLE ap.master_render_configs
        DROP CONSTRAINT IF EXISTS master_render_configs_visual_model_check;

    -- Slug only, exactly like the forward direction.
    UPDATE ap.master_render_configs
    SET visual_model = 'misto'
    WHERE visual_model = 'tvg_img';

    GET DIAGNOSTICS v_renamed = ROW_COUNT;

    SELECT count(*)
    INTO v_leftover
    FROM ap.master_render_configs
    WHERE visual_model NOT IN ('tvg', 'misto');

    IF v_leftover > 0 THEN
        RAISE EXCEPTION
            'MASTER_RENDER_CONFIG_VISUAL_MODEL_UNKNOWN count=%',
            v_leftover
            USING ERRCODE = '23514',
                  HINT =
                    'Rows carry a visual_model outside (tvg, misto). '
                    'Reconcile them before rerunning.';
    END IF;

    -- Restore the pre-20260727120000 constraint verbatim.
    ALTER TABLE ap.master_render_configs
        ADD CONSTRAINT master_render_configs_visual_model_check
        CHECK (visual_model IN ('tvg', 'misto'));

    EXECUTE $ddl$
        COMMENT ON COLUMN ap.master_render_configs.visual_model IS
            'Visual model (tvg | misto). Together with content_type it selects '
            'the fixed Placid template and implies the sponsor count '
            '(tvg=2, misto=1).'
    $ddl$;

    RAISE NOTICE 'Rolled back % master row(s) from tvg_img to misto.', v_renamed;
END;
$rollback$;
