import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const migration = await readFile(
  fileURLToPath(new URL(
    '../../supabase/migrations/20260806133000_fix_get_agencia_cliente_id_operational_tenant.sql',
    import.meta.url,
  )),
  'utf8',
)

test('operational client resolver uses explicit client or tenant membership and fails closed', () => {
  assert.match(migration, /FROM ap\.get_user_cliente_ids\(\) AS direct\(cliente_id\)/)
  assert.match(migration, /FROM public\.empresa_profissionais AS ep/)
  assert.match(migration, /tenant_empresa\.empresa_tipo = 'tenant'/)
  assert.match(migration, /client_empresa\.id = tenant_empresa\.id/)
  assert.match(migration, /client_empresa\.tenant_id = tenant_empresa\.id/)
  assert.match(migration, /OPERATIONAL_CLIENT_NOT_FOUND/)
  assert.match(migration, /OPERATIONAL_CLIENT_SELECTION_REQUIRED/)
  assert.match(migration, /auth\.uid\(\)/)
  const executableMigration = migration.replace(/^--.*$/gm, '')
  assert.doesNotMatch(executableMigration, /tipo_negocio|LIMIT\s+1|USING\s*\(\s*true\s*\)/i)
})

test('operational client resolver keeps explicit grants and anon denial', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_agencia_cliente_id\(\) FROM PUBLIC/)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_agencia_cliente_id\(\) FROM anon/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_agencia_cliente_id\(\) TO authenticated/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_agencia_cliente_id\(\) TO service_role/)
  assert.match(migration, /SET search_path = pg_catalog, public, ap, pg_temp/)
})
