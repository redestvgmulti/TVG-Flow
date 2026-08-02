import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
const tenant = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'
const uuid = '4e7pghwb4beji'
const tenantPredicate = new RegExp(`\\.cliente_id\\s*=\\s*'${tenant}'::uuid`, 'g')
const validation = await read('tests/master-v1/individual-feed-validation.sql')
const enablement = await read('tests/master-v1/individual-feed-enable.sql')
const isolationBefore = await read('tests/master-v1/individual-feed-tenant-isolation-before.sql')
const isolationAfter = await read('tests/master-v1/individual-feed-tenant-isolation-after.sql')

test('validation scopes master selection, conflict checks and final SELECT to the operational tenant', () => {
  assert.ok((validation.match(tenantPredicate) || []).length >= 8)
  assert.match(validation, new RegExp(`FROM ap\\.master_render_configs AS c[\\s\\S]*?WHERE c\\.cliente_id = '${tenant}'::uuid`))
  assert.match(validation, new RegExp(`c\\.master_template_uuid = '${uuid}'[\\s\\S]*?c\\.id <> v_master_id`))
  assert.match(validation, new RegExp(`FROM ap\\.master_render_configs AS c[\\s\\S]*?WHERE c\\.cliente_id = '${tenant}'::uuid[\\s\\S]*?c\\.content_type = 'feed'[\\s\\S]*?c\\.visual_model = 'individual'`))
  assert.doesNotMatch(validation, /UPDATE|DELETE|INSERT/i)
})

test('enablement scopes locked selection, UPDATE, conflicts and final SELECT to the operational tenant', () => {
  assert.ok((enablement.match(tenantPredicate) || []).length >= 8)
  assert.match(enablement, /FOR UPDATE;/)
  assert.match(enablement, new RegExp(`UPDATE ap\\.master_render_configs AS c[\\s\\S]*?SET enabled = true[\\s\\S]*?WHERE c\\.cliente_id = '${tenant}'::uuid`))
  assert.match(enablement, new RegExp(`c\\.content_type = 'feed'[\\s\\S]*?c\\.visual_model = 'individual'[\\s\\S]*?c\\.master_template_uuid = '${uuid}'`))
  assert.equal((enablement.match(/UPDATE ap\.master_render_configs/gi) || []).length, 1)
  assert.doesNotMatch(enablement, /SET\s+enabled\s*=\s*false/i)
})

test('two tenants sharing the same UUID are unambiguous and only the operational row is enabled', () => {
  const otherTenant = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const rows = [
    { cliente_id: tenant, master_template_uuid: uuid, content_type: 'feed', visual_model: 'individual', enabled: false },
    { cliente_id: otherTenant, master_template_uuid: uuid, content_type: 'feed', visual_model: 'individual', enabled: false },
  ]

  const selected = rows.filter(row =>
    row.cliente_id === tenant &&
    row.master_template_uuid === uuid &&
    row.content_type === 'feed' &&
    row.visual_model === 'individual'
  )
  assert.equal(selected.length, 1)
  selected[0].enabled = true
  assert.deepEqual(rows.map(row => [row.cliente_id, row.enabled]), [
    [tenant, true],
    [otherTenant, false],
  ])

  assert.match(isolationBefore, new RegExp(`'${otherTenant}'::uuid[\\s\\S]*?'${uuid}'[\\s\\S]*?false`))
  assert.match(isolationBefore, new RegExp(`WHERE c\\.cliente_id = '${tenant}'::uuid`))
  assert.equal((isolationAfter.match(/master_template_uuid = '4e7pghwb4beji'/g) || []).length, 2)
  assert.match(isolationAfter, /v_operational_enabled IS NOT TRUE/)
  assert.match(isolationAfter, /v_foreign_enabled IS NOT FALSE/)
})

test('both SQL artifacts reject global UUID-only targeting', () => {
  for (const sql of [validation, enablement]) {
    assert.doesNotMatch(sql, new RegExp(`WHERE\\s+(?:c\\.)?master_template_uuid\\s*=\\s*'${uuid}'`, 'i'))
    assert.doesNotMatch(sql, /cliente_id\s+IN\s*\(/i)
    assert.doesNotMatch(sql, /count\s*\(\s*DISTINCT\s+cliente_id\s*\)/i)
  }
})
