#!/usr/bin/env bash
# Runs every local SQL contract/test for the AutoPublisher against the running
# Supabase Postgres container. Each file is self-contained (BEGIN/ROLLBACK or its
# own cleanup), deterministic, and depends only on the migrated schema -- never
# on production data. Usage: bash tests/master-v1/run-sql-contracts.sh
set -uo pipefail

DB="${SUPABASE_DB_CONTAINER:-supabase_db_TVG-Flow}"
HERE="$(cd "$(dirname "$0")" && pwd)"

CONTRACTS=(
  profissional-name-fallback.sql
  ap-images-bucket.sql
  sponsor-rotation-contract.sql
  sponsor-storage-isolation.sql
  visual-title-group-snapshot-contract.sql
  visual-title-groups-contract.sql
  autopublisher-e2e.sql
  tarefas-rls-equivalence.sql
  master-render-config.sql
)

fail=0
for c in "${CONTRACTS[@]}"; do
  out="$(docker exec -i "$DB" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 < "$HERE/$c" 2>&1)"
  if printf '%s\n' "$out" | grep -q "$c: PASS"; then
    echo "PASS  $c"
  else
    echo "FAIL  $c"
    printf '%s\n' "$out" | grep -iE "ERROR|ASSERTION|violates|denied" | head -5 | sed 's/^/        /'
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "ALL SQL CONTRACTS PASS"
else
  echo "SOME SQL CONTRACTS FAILED"
fi
exit "$fail"
