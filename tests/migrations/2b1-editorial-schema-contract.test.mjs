import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const migrationNames = await readdir(migrationsDir)

const readMigration = async (suffix) => {
  const name = migrationNames.find((candidate) => candidate.endsWith(suffix))
  assert.ok(name, `migration ending with ${suffix} must exist`)
  return readFile(path.join(migrationsDir, name), 'utf8')
}

const m1 = await readMigration('_2b1_editorial_origin_and_production_intent.sql')
const m2 = await readMigration('_2b1_editorial_state_machine_expansion.sql')
const m3 = await readMigration('_2b1_editorial_direct_origin_rpc.sql')
const m4 = await readMigration('_2b1_editorial_production_intent_rpc.sql')
const m5 = await readMigration('_2b1_editorial_review_and_freeze_rpcs.sql')
const m6 = await readMigration('_2b1_editorial_render_handoff_rpcs.sql')
const m7 = await readMigration('_2b1_backlog_editorial_exclusivity.sql')
const allSql = [m1, m2, m3, m4, m5, m6, m7].join('\n\n')

test('2B.1 never touches candidate_news/render_generations/ap_private structurally', () => {
  assert.doesNotMatch(allSql, /ALTER TABLE\s+ap\.candidate_news/i)
  assert.doesNotMatch(allSql, /ALTER TABLE\s+ap\.render_generations/i)
  assert.doesNotMatch(allSql, /CREATE\s+(?:OR REPLACE\s+)?(?:TABLE|FUNCTION|TRIGGER)\s+ap_private\./i)
  // The only writes to candidate_news are reads/validation inside the
  // handoff RPC (SELECT), never a mutation from this migration set.
  assert.doesNotMatch(allSql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+ap\.candidate_news/i)
  assert.doesNotMatch(allSql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+ap\.render_generations/i)
})

test('2B.1 grants: render handoff RPCs are service_role only, the rest are authenticated', () => {
  const serviceOnly = ['claim_editorial_article_for_render', 'attach_editorial_article_candidate']
  const authenticated = [
    'start_editorial_article_direct',
    'save_editorial_article_production_intent',
    'request_editorial_article_changes',
    'approve_editorial_article_for_render',
  ]
  for (const fn of serviceOnly) {
    assert.match(allSql, new RegExp(`GRANT EXECUTE ON FUNCTION ap\\.${fn}\\([^)]*\\)\\s+TO service_role`))
    assert.doesNotMatch(allSql, new RegExp(`GRANT EXECUTE ON FUNCTION ap\\.${fn}\\([^)]*\\)\\s+TO authenticated`))
  }
  for (const fn of authenticated) {
    assert.match(allSql, new RegExp(`GRANT EXECUTE ON FUNCTION ap\\.${fn}\\([^)]*\\)\\s+TO authenticated`))
  }
})

test('2B.1 widens every CHECK constraint without dropping a prior value', () => {
  // status: draft/editing/content_final/abandoned (R1) must all survive.
  const statusCheck = allSql.match(/CHECK \(status IN \(([^)]+)\)\)/)
  assert.ok(statusCheck, 'editorial_articles_status_check must be redefined')
  for (const value of ['draft', 'editing', 'content_final', 'changes_requested', 'ready_for_render', 'dispatched', 'abandoned']) {
    assert.match(statusCheck[1], new RegExp(`'${value}'`))
  }

  const actionCheck = allSql.match(/CHECK \(action IN \(([^)]+)\)\)/)
  assert.ok(actionCheck, 'editorial_article_events_action_check must be redefined')
  for (const value of [
    'article_created', 'draft_saved', 'content_finalized', 'article_reopened',
    'article_abandoned', 'article_reactivated', 'changes_requested', 'approved_for_render', 'render_dispatched',
  ]) {
    assert.match(actionCheck[1], new RegExp(`'${value}'`))
  }
})

test('2B.1 avoids a duplicate-overload trap: every widened RPC signature drops the old one first', () => {
  // CREATE OR REPLACE with a new parameter count creates a second overload
  // instead of replacing the function -- this migration set must guard
  // against reproducing the pre-existing list_my_editorial_articles bug.
  for (const fn of ['save_editorial_article_draft', 'finalize_editorial_article', 'list_my_editorial_articles']) {
    assert.match(allSql, new RegExp(`DROP FUNCTION IF EXISTS ap\\.${fn}\\(`),
      `${fn} must DROP its prior signature before CREATE OR REPLACE with a different arity`)
  }
})

test('2B.1 origin_type/news_backlog_id consistency is enforced at the constraint level, not just in RPCs', () => {
  assert.match(allSql, /CHECK \(\(origin_type = 'news_backlog'\) = \(news_backlog_id IS NOT NULL\)\)/)
})

test('2B.1 a candidate can never be claimed by two editorial articles', () => {
  assert.match(allSql, /UNIQUE \(candidate_news_id\)/)
  assert.match(allSql, /CANDIDATE_ALREADY_ATTACHED/)
})

test('2B.1 freeze trigger exists and covers status leaving ready_for_render/dispatched', () => {
  assert.match(allSql, /CREATE TRIGGER editorial_article_freeze BEFORE UPDATE ON ap\.editorial_articles/)
  assert.match(allSql, /OLD\.status NOT IN \('ready_for_render', 'dispatched'\)/)
})
