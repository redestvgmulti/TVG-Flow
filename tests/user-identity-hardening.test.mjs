import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { normalizeRole } from '../src/utils/roles.js'

const root = new URL('../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')

const migrationPath = 'supabase/migrations/20260816120000_user_identity_normalization_and_access_hardening.sql'

test('role normalization keeps the legacy alias but fails closed for unknown roles', () => {
  assert.equal(normalizeRole('super_admin'), 'super_admin')
  assert.equal(normalizeRole('admin'), 'admin')
  assert.equal(normalizeRole('staff'), 'staff')
  assert.equal(normalizeRole('profissional'), 'staff')
  assert.equal(normalizeRole('owner'), null)
  assert.equal(normalizeRole(null), null)
})

test('identity migration is snapshot-backed, soft-only and guarded by postconditions', async () => {
  const sql = await read(migrationPath)

  assert.match(sql, /private\.user_access_normalization_snapshots/)
  assert.match(sql, /expected 21 non-deleted Auth users/)
  assert.match(sql, /expected 14 legacy professionals/)
  assert.match(sql, /UPDATE public\.empresa_profissionais ep\s+SET ativo = false/i)
  assert.match(sql, /UPDATE public\.cliente_profissionais SET ativo = false/i)
  assert.doesNotMatch(sql, /DELETE FROM public\.(?:profissionais|empresa_profissionais|cliente_profissionais)/i)
  assert.match(sql, /POSTCONDITION_FAILED: legacy roles remain/)
  assert.match(sql, /CHECK \(role IN \('super_admin', 'admin', 'staff'\)\)/)
})

test('database closes direct profile mutation and public server RPC execution', async () => {
  const sql = await read(migrationPath)

  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public\.profissionais FROM authenticated/)
  assert.match(sql, /CREATE POLICY profissionais_tenant_select/)
  assert.match(sql, /CREATE TRIGGER trg_protect_professional_sensitive_fields/)
  assert.match(sql, /CREATE TRIGGER trg_enforce_single_active_tenant_membership/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_tenant_db[^;]+FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.provision_professional_identity[^;]+FROM PUBLIC, anon, authenticated/)
})

test('management functions authenticate active operators and enforce role scope', async () => {
  const [shared, createProfessional, updateProfessional, recovery, createTenant, bootstrap, config] = await Promise.all([
    read('supabase/functions/_shared/operatorAuth.ts'),
    read('supabase/functions/create-professional/index.ts'),
    read('supabase/functions/update-professional/index.ts'),
    read('supabase/functions/generate-recovery-link/index.ts'),
    read('supabase/functions/create-tenant/index.ts'),
    read('supabase/functions/bootstrap-admin-tenant/index.ts'),
    read('supabase/config.toml'),
  ])

  assert.match(shared, /profile\.ativo !== true/)
  assert.match(shared, /tenantIds\.length !== 1/)
  assert.match(createProfessional, /Tenant admins may create staff only/)
  assert.match(createProfessional, /provision_professional_identity/)
  assert.match(updateProfessional, /FORBIDDEN_FIELDS/)
  assert.match(updateProfessional, /Only a super administrator may change roles/)
  assert.match(recovery, /SUPER_ADMIN_PROTECTED/)
  assert.match(recovery, /TENANT_SCOPE_FORBIDDEN/)
  assert.match(createTenant, /\['super_admin'\]/)
  assert.match(bootstrap, /Automatic tenant selection is forbidden/)

  for (const functionName of [
    'create-professional',
    'update-professional',
    'delete-professional',
    'generate-recovery-link',
    'create-tenant',
    'bootstrap-admin-tenant',
  ]) {
    assert.match(config, new RegExp(`\\[functions\\.${functionName}\\]\\s+verify_jwt = true`))
  }
})
