#!/usr/bin/env bash
# Deploy gates for 20260727120000 (misto → tvg_img).
#
# Unlike the .sql contracts, these gates execute the REAL migration file and the
# REAL rollback file — never a copy of their logic. Each gate composes one psql
# stream in a temp file:
#
#     BEGIN; <fixture> ; <the actual .sql file> ; <assertions> ; ROLLBACK;
#
# so nothing is left behind and the gates run against whatever state the local
# database happens to be in (pre- or post-migration).
#
# Usage: bash tests/master-v1/run-migration-gates.sh
set -uo pipefail

DB="${SUPABASE_DB_CONTAINER:-supabase_db_TVG-Flow}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

MIGRATION="$ROOT/supabase/migrations/20260727120000_rename_visual_model_misto_to_tvg_img.sql"
ROLLBACK_SQL="$ROOT/supabase/rollback/20260727120000_rollback_rename_visual_model_tvg_img_to_misto.sql"

for f in "$MIGRATION" "$ROLLBACK_SQL"; do
  [ -f "$f" ] || { echo "MISSING $f"; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CLIENTE='7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c'
FEED_LAYERS='{"headline":"titulo-materia","news_image":"news-image","visual_title":"titulo-png","sponsor_1":"patrocinador-1","sponsor_2":"patrocinador-2"}'
REELS_LAYERS='{"headline":"titulo-materia","visual_title":"titulo-png","sponsor_1":"patrocinador-1","sponsor_2":"patrocinador-2"}'

# Rebuilds the exact pre-migration state, whatever the database currently holds:
# the legacy CHECK, the four masters with deliberately mixed `enabled`, and one
# historical matéria frozen with the retired slug.
emit_fixture() {
  cat >>"$1" <<SQL
ALTER TABLE ap.master_render_configs
    DROP CONSTRAINT IF EXISTS master_render_configs_visual_model_check;

-- Rebuild the pre-migration contract for the WHOLE table, not just this
-- tenant: the gates must behave identically whether or not the migration has
-- already been applied to the database they run against. Everything is rolled
-- back, so other tenants' rows are never really touched.
UPDATE ap.master_render_configs SET visual_model = 'misto'
WHERE visual_model = 'tvg_img';

ALTER TABLE ap.master_render_configs
    ADD CONSTRAINT master_render_configs_visual_model_check
    CHECK (visual_model IN ('tvg', 'misto'));

INSERT INTO public.clientes (id, nome)
VALUES ('$CLIENTE', 'Tenant gates rename')
ON CONFLICT (id) DO NOTHING;

DELETE FROM ap.master_render_configs WHERE cliente_id = '$CLIENTE';

INSERT INTO ap.master_render_configs
    (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
VALUES
    ('$CLIENTE', 'feed',  'tvg',   'mzszfje7xdh6l', true,  '$FEED_LAYERS'::jsonb),
    ('$CLIENTE', 'feed',  'misto', '3pm4re4blrizh', false, '$FEED_LAYERS'::jsonb),
    ('$CLIENTE', 'reels', 'tvg',   'xcxtk9tt7syfd', false, '$REELS_LAYERS'::jsonb),
    ('$CLIENTE', 'reels', 'misto', 'rrbcykdqcrqae', true,  '$REELS_LAYERS'::jsonb);

INSERT INTO ap.candidate_news
    (cliente_id, titulo, url_original, status, content_type, sponsor_count,
     render_contract_version, render_snapshot)
VALUES (
    '$CLIENTE', 'Materia historica misto',
    'https://historico.test/gates-misto', 'pending_render', 'feed', 1,
    'master_v1',
    jsonb_build_object(
        'render_contract_version', 'master_v1',
        'sponsor_source', 'rotation_v1',
        'visual_model', 'misto',
        'master_config', jsonb_build_object(
            'master_template_uuid', '3pm4re4blrizh',
            'visual_model', 'misto'))
);

-- Snapshot of the fixture, so an assertion can prove nothing drifted.
CREATE TEMP TABLE gate_before AS
SELECT content_type, visual_model, master_template_uuid, enabled, layer_map
FROM ap.master_render_configs WHERE cliente_id = '$CLIENTE';
SQL
}

# Emits a SELECT-based diff assertion between a temp snapshot and the live rows.
emit_no_drift() {
  local file="$1" snapshot="$2" label="$3" cols="$4"
  cat >>"$file" <<SQL
DO \$gate\$
DECLARE
    v_diff integer;
BEGIN
    SELECT count(*) INTO v_diff FROM (
        (SELECT * FROM $snapshot
         EXCEPT
         SELECT $cols FROM ap.master_render_configs WHERE cliente_id = '$CLIENTE')
        UNION ALL
        (SELECT $cols FROM ap.master_render_configs WHERE cliente_id = '$CLIENTE'
         EXCEPT
         SELECT * FROM $snapshot)
    ) d;
    IF v_diff <> 0 THEN
        RAISE EXCEPTION 'ASSERTION: $label (% row(s) differ)', v_diff;
    END IF;
END
\$gate\$;
SQL
}

# $1 = gate name, $2 = stream file, $3 = extra grep the output must satisfy.
run_gate() {
  local name="$1" file="$2" must_contain="${3:-}" out stop=1
  # The collision gate deliberately provokes an error and recovers from a
  # savepoint, so it runs without ON_ERROR_STOP.
  [ -n "$must_contain" ] && stop=0
  {
    echo "BEGIN;"
    cat "$file"
    echo "ROLLBACK;"
  } >"$file.stream"

  out="$(docker exec -i "$DB" psql -U postgres -d postgres -q -v ON_ERROR_STOP=$stop \
        <"$file.stream" 2>&1)"

  local ok=1
  printf '%s\n' "$out" | grep -q "GATE OK" || ok=0
  if [ -n "$must_contain" ]; then
    printf '%s\n' "$out" | grep -q "$must_contain" || ok=0
  fi

  if [ "$ok" -eq 1 ]; then
    echo "PASS  $name"
    return 0
  fi
  echo "FAIL  $name"
  printf '%s\n' "$out" | grep -iE "ERROR|ASSERTION|FATAL|violates" | head -6 | sed 's/^/        /'
  return 1
}

fail=0
COLS_FULL="content_type, visual_model, master_template_uuid, enabled, layer_map"
COLS_SLIM="content_type, visual_model, master_template_uuid, enabled"

# ── Gate 1: upgrade ────────────────────────────────────────────────────────
# The slug moves; UUID, enabled and layer_map do not; the frozen snapshot is
# untouched; the new CHECK is live and uniqueness still holds.
G="$WORK/g1.sql"; : >"$G"
emit_fixture "$G"
cat "$MIGRATION" >>"$G"
cat >>"$G" <<SQL
DO \$gate\$
DECLARE
    v_row ap.master_render_configs%ROWTYPE;
    v_expected jsonb := '{
        "feed/tvg":      {"uuid": "mzszfje7xdh6l", "enabled": true},
        "feed/tvg_img":  {"uuid": "3pm4re4blrizh", "enabled": false},
        "reels/tvg":     {"uuid": "xcxtk9tt7syfd", "enabled": false},
        "reels/tvg_img": {"uuid": "rrbcykdqcrqae", "enabled": true}
    }'::jsonb;
    v_key text;
BEGIN
    IF EXISTS (SELECT 1 FROM ap.master_render_configs
               WHERE cliente_id = '$CLIENTE' AND visual_model = 'misto') THEN
        RAISE EXCEPTION 'ASSERTION: a legacy master slug survived the upgrade';
    END IF;

    FOR v_key IN SELECT jsonb_object_keys(v_expected) LOOP
        SELECT * INTO v_row FROM ap.master_render_configs
        WHERE cliente_id = '$CLIENTE'
          AND content_type = split_part(v_key, '/', 1)
          AND visual_model = split_part(v_key, '/', 2);
        IF NOT FOUND THEN
            RAISE EXCEPTION 'ASSERTION: master % missing after upgrade', v_key;
        END IF;
        IF v_row.master_template_uuid <> (v_expected -> v_key ->> 'uuid') THEN
            RAISE EXCEPTION 'ASSERTION: upgrade changed the UUID of %', v_key;
        END IF;
        IF v_row.enabled <> ((v_expected -> v_key ->> 'enabled')::boolean) THEN
            RAISE EXCEPTION 'ASSERTION: upgrade changed enabled on %', v_key;
        END IF;
        IF (v_row.layer_map ->> 'sponsor_1') <> 'patrocinador-1' THEN
            RAISE EXCEPTION 'ASSERTION: upgrade changed the layer map of %', v_key;
        END IF;
    END LOOP;

    -- The historical snapshot is literally untouched.
    IF NOT EXISTS (
        SELECT 1 FROM ap.candidate_news
        WHERE cliente_id = '$CLIENTE'
          AND render_snapshot ->> 'visual_model' = 'misto'
          AND render_snapshot -> 'master_config' ->> 'master_template_uuid' = '3pm4re4blrizh'
    ) THEN
        RAISE EXCEPTION 'ASSERTION: a historical snapshot was rewritten';
    END IF;

    -- The new CHECK is live and refuses the retired slug.
    BEGIN
        INSERT INTO ap.master_render_configs
            (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
        VALUES ('$CLIENTE', 'feed', 'misto', 'x', false, '{}'::jsonb);
        RAISE EXCEPTION 'ASSERTION: the post-upgrade CHECK accepted misto';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- Uniqueness still forbids an ambiguous fifth master.
    BEGIN
        INSERT INTO ap.master_render_configs
            (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
        VALUES ('$CLIENTE', 'feed', 'tvg_img', 'dup', false, '{}'::jsonb);
        RAISE EXCEPTION 'ASSERTION: a duplicate master was accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;

    RAISE NOTICE 'GATE OK';
END
\$gate\$;
SQL
run_gate "upgrade" "$G" || fail=1

# ── Gate 2: re-execution is a byte-for-byte no-op ──────────────────────────
G="$WORK/g2.sql"; : >"$G"
emit_fixture "$G"
cat "$MIGRATION" >>"$G"
cat >>"$G" <<SQL
CREATE TEMP TABLE gate_after_first AS
SELECT $COLS_FULL
FROM ap.master_render_configs WHERE cliente_id = '$CLIENTE';
SQL
cat "$MIGRATION" >>"$G"
emit_no_drift "$G" "gate_after_first" "rerunning the migration changed rows" "$COLS_FULL"
cat >>"$G" <<SQL
DO \$gate\$
BEGIN
    IF (SELECT count(*) FROM ap.master_render_configs
        WHERE cliente_id = '$CLIENTE') <> 4 THEN
        RAISE EXCEPTION 'ASSERTION: rerun changed the number of masters';
    END IF;
    RAISE NOTICE 'GATE OK';
END
\$gate\$;
SQL
run_gate "rerun" "$G" || fail=1

# ── Gate 3: collision aborts with 23505 and changes nothing ────────────────
# The migration runs for real and is expected to raise; a savepoint lets the
# stream recover and prove the state is untouched.
G="$WORK/g3.sql"; : >"$G"
emit_fixture "$G"
cat >>"$G" <<SQL
-- Give the tenant BOTH slugs for feed: the state the rename must refuse.
ALTER TABLE ap.master_render_configs
    DROP CONSTRAINT IF EXISTS master_render_configs_visual_model_check;
INSERT INTO ap.master_render_configs
    (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
VALUES ('$CLIENTE', 'feed', 'tvg_img', 'colisao-uuid', true, '$FEED_LAYERS'::jsonb);
ALTER TABLE ap.master_render_configs
    ADD CONSTRAINT master_render_configs_visual_model_check
    CHECK (visual_model IN ('tvg', 'misto', 'tvg_img'));

CREATE TEMP TABLE gate_collision_before AS
SELECT $COLS_SLIM
FROM ap.master_render_configs WHERE cliente_id = '$CLIENTE';

SAVEPOINT before_migration;
SQL
cat "$MIGRATION" >>"$G"
cat >>"$G" <<SQL
ROLLBACK TO SAVEPOINT before_migration;
SQL
emit_no_drift "$G" "gate_collision_before" "the aborted migration still changed rows" "$COLS_SLIM"
cat >>"$G" <<SQL
DO \$gate\$
BEGIN
    -- The fixture's constraint must still be the one in force: the aborted
    -- migration may not leave the column unconstrained.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'master_render_configs_visual_model_check'
          AND conrelid = 'ap.master_render_configs'::regclass
    ) THEN
        RAISE EXCEPTION
            'ASSERTION: the aborted migration left the column unconstrained';
    END IF;
    IF (SELECT count(*) FROM ap.master_render_configs
        WHERE cliente_id = '$CLIENTE' AND visual_model = 'misto') <> 2 THEN
        RAISE EXCEPTION 'ASSERTION: the aborted migration renamed rows anyway';
    END IF;
    RAISE NOTICE 'GATE OK';
END
\$gate\$;
SQL
run_gate "collision" "$G" "MASTER_RENDER_CONFIG_VISUAL_MODEL_RENAME_COLLISION" || fail=1

# ── Gate 4: absent table is a clean no-op ──────────────────────────────────
# The table is renamed away inside the transaction, so the migration sees a
# database that simply does not have it.
G="$WORK/g4.sql"; : >"$G"
cat >>"$G" <<SQL
ALTER TABLE ap.master_render_configs RENAME TO master_render_configs_hidden;
SQL
cat "$MIGRATION" >>"$G"
cat >>"$G" <<SQL
DO \$gate\$
BEGIN
    IF to_regclass('ap.master_render_configs') IS NOT NULL THEN
        RAISE EXCEPTION 'ASSERTION: the migration recreated the absent table';
    END IF;
    -- No partial object may point at a table that does not exist.
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'ap'
          AND indexname IN (
              'uq_master_render_config_per_visual_model',
              'idx_master_render_configs_visual_model_lookup')
          AND tablename <> 'master_render_configs_hidden'
    ) THEN
        RAISE EXCEPTION 'ASSERTION: the migration left a dangling index';
    END IF;
    RAISE NOTICE 'GATE OK';
END
\$gate\$;
SQL
run_gate "absent-table" "$G" || fail=1

# ── Gate 5: the rollback script really restores the previous contract ──────
G="$WORK/g5.sql"; : >"$G"
emit_fixture "$G"
cat "$MIGRATION" >>"$G"
cat "$ROLLBACK_SQL" >>"$G"
emit_no_drift "$G" "gate_before" "the round trip did not restore the state" "$COLS_FULL"
cat >>"$G" <<SQL
DO \$gate\$
BEGIN
    -- The previous CHECK is back: misto accepted, tvg_img refused.
    BEGIN
        INSERT INTO ap.master_render_configs
            (cliente_id, content_type, visual_model, master_template_uuid, enabled, layer_map)
        VALUES ('$CLIENTE', 'reels', 'tvg_img', 'x', false, '{}'::jsonb);
        RAISE EXCEPTION 'ASSERTION: the restored CHECK still accepts tvg_img';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- The historical snapshot survived the round trip untouched.
    IF NOT EXISTS (
        SELECT 1 FROM ap.candidate_news
        WHERE cliente_id = '$CLIENTE'
          AND render_snapshot ->> 'visual_model' = 'misto'
    ) THEN
        RAISE EXCEPTION 'ASSERTION: the round trip rewrote a historical snapshot';
    END IF;
    RAISE NOTICE 'GATE OK';
END
\$gate\$;
SQL
run_gate "rollback-roundtrip" "$G" || fail=1

if [ "$fail" -eq 0 ]; then
  echo "ALL MIGRATION GATES PASS"
else
  echo "SOME MIGRATION GATES FAILED"
fi
exit "$fail"
