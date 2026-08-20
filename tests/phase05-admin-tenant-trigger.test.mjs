import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../supabase/migrations/20260819220000_fix_admin_tenant_trigger_search_path.sql',
  import.meta.url,
)

test('Phase 0.5 tenant provisioning trigger is schema-qualified and fail-closed', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.has_active_tenant_link\(prof_id uuid\)/)
  assert.match(sql, /FROM public\.empresa_profissionais AS membership/)
  assert.match(sql, /JOIN public\.empresas AS tenant/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.enforce_admin_role_requires_tenant\(\)/)
  assert.match(sql, /SET search_path = ''/)
  assert.match(sql, /public\.has_active_tenant_link\(NEW\.id\)/)
  assert.match(sql, /RAISE EXCEPTION[\s\S]*TENANT_LINK_REQUIRED/)
  assert.doesNotMatch(sql, /DISABLE TRIGGER|session_replication_role/i)
})
