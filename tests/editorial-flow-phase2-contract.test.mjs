import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('phase 2 migration preserves data and gates recovery, timeline and posting by tenant admin access', async () => {
  const migration = await source('supabase/migrations/20260828143013_editorial_flow_visibility_and_recovery.sql')

  assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.admin_release_news_backlog_item/)
  assert.match(migration, /ap\.require_editorial_admin_access\(p_cliente_id\)/)
  assert.match(migration, /v_before\.status <> 'adopted'/)
  assert.match(migration, /v_before\.candidate_news_id IS NOT NULL/)
  assert.match(migration, /'admin_released'/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.list_team_news_work_details/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.list_news_backlog_timeline/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.mark_candidate_news_posted/)
  assert.match(migration, /candidate\.status = 'approved'/)
  assert.match(migration, /professional\.role IN \('admin', 'super_admin', 'staff'\)/)
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b|\bTRUNCATE\b|DROP TABLE/i)
})

test('editorial UI separates production, review, approval and publication states', async () => {
  const ui = await source('src/pages/admin/AutoPublisher.jsx')
  const collected = await source('src/components/editorial/CollectedNewsPanel.jsx')

  assert.match(ui, /\{ key: 'em_producao', label: 'Em produção' \}/)
  assert.match(ui, /\{ key: 'revisao', label: 'Aguardando revisão' \}/)
  assert.match(ui, /pending_render: 'em_producao'/)
  assert.match(ui, /pending_review: 'revisao'/)
  assert.match(ui, /if \(currentTab === 'aprovadas'\) statuses = \['approved'\]/)
  assert.match(ui, /if \(item\.status !== 'approved'\) return/)
  assert.match(ui, /mark_candidate_news_posted/)
  assert.match(ui, /Aprovar para publicação/)
  assert.match(collected, /Aprovar pauta/)
  assert.match(ui, /const handleCollectedCountsChange = useCallback/)
  assert.match(ui, /onCountsChange=\{handleCollectedCountsChange\}/)
  assert.match(collected, /try \{[\s\S]*\} finally \{[\s\S]*setLoading\(false\)/)
  assert.doesNotMatch(ui, /pending_render: 'aprovadas'/)
  assert.doesNotMatch(ui, /processing: 'aprovadas'/)
})

test('super administrator has the same editorial entry points only with an explicit active client', async () => {
  const app = await source('src/App.jsx')
  const backlog = await source('src/components/editorial/NewsBacklogPanel.jsx')
  const approval = await source('supabase/functions/ap-content-production/index.ts')
  const tenantAuthorization = await source('supabase/functions/ap-employee-generator/tenantAuthorization.ts')

  assert.match(app, /allowedRole=\{\['admin', 'super_admin'\]\}/)
  assert.match(backlog, /role === 'admin' \|\| role === 'super_admin'/)
  assert.match(approval, /\["admin", "super_admin"\]/)
  assert.match(tenantAuthorization, /profile\.role === "super_admin"/)
  assert.match(tenantAuthorization, /\.eq\("ativo", true\)/)
  assert.match(tenantAuthorization, /typeof requestedClienteId !== "string"/)
})

test('staff work remains separate between adopted pautas and started productions', async () => {
  const myWork = await source('src/pages/staff/MyNewsWork.jsx')
  const teamWork = await source('src/components/editorial/TeamNewsWorkPanel.jsx')

  assert.match(myWork, /const adoptedItems = items\.filter/)
  assert.match(myWork, /const productionItems = items\.filter/)
  assert.match(myWork, /Minhas Pautas/)
  assert.match(myWork, /Minhas Produções/)
  assert.match(myWork, /release_news_backlog_item/)
  assert.match(teamWork, /admin_release_news_backlog_item/)
  assert.match(teamWork, /list_news_backlog_timeline/)
})
