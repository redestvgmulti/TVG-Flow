import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '../..')
const migrationPath = path.join(
  root,
  'supabase/migrations/20260817160500_revoke_service_role_from_operational_cliente_resolver.sql',
)
const migration = fs.readFileSync(migrationPath, 'utf8')

test('resolver ACL correction is targeted and leaves the function definition untouched', () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.require_single_operational_cliente_id\(\)\s+FROM service_role;/,
  )
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.require_single_operational_cliente_id\(\)\s+FROM PUBLIC;/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.require_single_operational_cliente_id\(\)\s+FROM anon;/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.require_single_operational_cliente_id\(\)\s+TO authenticated;/)
  assert.doesNotMatch(migration, /CREATE\s+OR\s+REPLACE\s+FUNCTION/i)
  assert.doesNotMatch(migration, /ALTER\s+DEFAULT\s+PRIVILEGES/i)
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i)
})
