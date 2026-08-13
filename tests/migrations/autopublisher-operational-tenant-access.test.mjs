import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(
  new URL(
    '../../supabase/migrations/20260813175807_autopublisher_operational_tenant_access.sql',
    import.meta.url,
  ),
  'utf8',
)

test('operational AutoPublisher access is tenant-scoped and read-only in RLS', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.get_operational_cliente_ids\(\)/)
  assert.match(migration, /public\.cliente_profissionais AS membership/)
  assert.match(migration, /public\.empresa_profissionais AS membership/)
  assert.match(migration, /tenant_empresa\.empresa_tipo = 'tenant'/)
  assert.match(migration, /auth\.uid\(\)/)
  assert.match(migration, /REVOKE ALL ON FUNCTION ap\.get_operational_cliente_ids\(\) FROM PUBLIC/)
  assert.match(migration, /REVOKE ALL ON FUNCTION ap\.get_operational_cliente_ids\(\) FROM anon/)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION ap\.get_operational_cliente_ids\(\) TO authenticated, service_role/)

  for (const table of [
    'visual_titles',
    'visual_title_groups',
    'master_render_controls',
    'master_render_configs',
    'render_sponsors',
    'render_sponsor_scope_memberships',
    'territorial_composer_features',
  ]) {
    assert.match(
      migration,
      new RegExp(`ON ap\\.${table}\\s+FOR SELECT TO authenticated\\s+USING \\(cliente_id IN \\(SELECT ap\\.get_operational_cliente_ids\\(\\)\\)\\)`, 's'),
    )
  }

  const executable = migration.replace(/^--.*$/gm, '')
  assert.doesNotMatch(executable, /USING\s*\(\s*true\s*\)/i)
  assert.doesNotMatch(executable, /FOR ALL TO authenticated[\s\S]*get_operational_cliente_ids/i)
})

test('territorial RPC uses the operational allowlist and still requires its feature flag', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.require_territorial_composer_access/)
  assert.match(migration, /FROM ap\.get_operational_cliente_ids\(\) AS allowed\(cliente_id\)/)
  assert.match(migration, /RAISE EXCEPTION 'TENANT_FORBIDDEN'/)
  assert.match(migration, /FROM ap\.territorial_composer_features AS feature/)
  assert.match(migration, /RAISE EXCEPTION 'TERRITORIAL_COMPOSER_DISABLED'/)
  assert.match(migration, /REVOKE ALL ON FUNCTION ap\.require_territorial_composer_access\(uuid\) FROM PUBLIC, anon/)
})
