import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const quarantined = [
  'diagnostic-tool',
  'test-db',
  'ap-feed-composer',
  'ap-learning-engine',
  'ap-scheduler',
  'ap-send-to-studio',
  'get_super_admin_dashboard_stats',
  'create-microtasks',
  'return-micro-tasks',
  'scheduler-deadline-notifications',
  'process-notifications',
]

const jwtRequired = [
  'alterar-prazo-os',
  'complete-micro-task',
  'converter-os-para-complexa',
  'delete-task-attachment',
  'excluir-os',
  'return-micro-task',
  'system-check',
]

const secretProtected = [
  'ap-instagram-publisher',
  'meeting-reminders',
  'notify-overdue-tasks',
  'send-push-notification',
]

test('quarantined production diagnostics cannot be redeployed from source', () => {
  for (const name of quarantined) {
    assert.equal(
      existsSync(join(root, 'supabase', 'functions', name, 'index.ts')),
      false,
      `${name} source must remain quarantined`,
    )
  }
})

test('human functions require JWT in canonical config', () => {
  const config = read('supabase/config.toml')
  for (const name of jwtRequired) {
    assert.match(
      config,
      new RegExp(`\\[functions\\.${name.replaceAll('-', '\\-')}\\]\\s+verify_jwt = true`, 'm'),
    )
  }
})

test('non-JWT workers fail closed on the internal secret', () => {
  const config = read('supabase/config.toml')
  for (const name of secretProtected) {
    assert.match(
      config,
      new RegExp(`\\[functions\\.${name.replaceAll('-', '\\-')}\\]\\s+verify_jwt = false`, 'm'),
    )
    assert.match(
      read(`supabase/functions/${name}/index.ts`),
      /isTrustedInternalRequest\(req\)/,
      `${name} must reject requests before using service credentials`,
    )
  }
})

test('migration contains default-deny table and routine controls', () => {
  const migration = read('supabase/migrations/20260823133000_contain_production_p0.sql')
  for (const table of [
    'backup_empresa_profissionais',
    'backup_tarefas_micro',
    'empresa_profissionais_backup_2026_01_12',
    'tarefas_backup_20260112',
    'notification_queue',
    'overdue_notifications_log',
    'template_queue_state',
  ]) {
    assert.match(migration, new RegExp(`ALTER TABLE (?:public|ap)\\.${table} ENABLE ROW LEVEL SECURITY`))
  }

  assert.match(migration, /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon/)
  assert.match(migration, /get_user_emails_for_ap/)
  assert.match(migration, /insert_secret/)
  assert.match(migration, /participant must match session identity/)
  assert.match(migration, /x-ap-internal-secret/)
})

test('tracked credential backup is removed and ignored', () => {
  assert.equal(existsSync(join(root, '.env.local.bak')), false)
  assert.match(read('.gitignore'), /^\.env\.local\.bak$/m)
})

test('downloaded singular return endpoint is tenant-scoped', () => {
  const source = read('supabase/functions/return-micro-task/index.ts')
  assert.match(source, /empresa_profissionais/)
  assert.match(source, /taskCompanyId/)
  assert.match(source, /\.eq\('profissionais\.ativo', true\)/)
  assert.match(source, /Target professional is not active in this tenant/)
})

test('attachment deletion requires active tenant membership', () => {
  const source = read('supabase/functions/delete-task-attachment/index.ts')
  assert.match(source, /const canDelete = Boolean\(callerAccess\)/)
  assert.match(source, /\.eq\('profissionais\.ativo', true\)/)
  assert.doesNotMatch(source, /role === 'super_admin'/)
})

test('system check is restricted to an active super-admin', () => {
  const source = read('supabase/functions/system-check/index.ts')
  assert.match(source, /professional\.role !== 'super_admin'/)
  assert.doesNotMatch(source, /\['admin', 'super_admin'\]\.includes/)
})
