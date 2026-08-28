import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('curated worker cannot insert candidate_news and records collection outcomes', () => {
  const worker = read('supabase/functions/ap-data-ingestion/index.ts')
  assert.doesNotMatch(worker, /from\(["']candidate_news["']\)\.insert/)
  assert.match(worker, /rpc\(["']ingest_collected_news["']/)
  assert.match(worker, /duplicate_count/)
  assert.match(worker, /source_domain/)
  assert.match(worker, /destination:\s*"ap\.collected_news"/)
})

test('forward-only activation migration keeps curation tenant-safe and pins a 30 minute cron', () => {
  const migration = read('supabase/migrations/20260828110000_activate_curated_ingestion_pipeline.sql')
  assert.doesNotMatch(migration, /(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\s+(?:ap\.)?(?:candidate_news|collected_news|news_backlog)/i)
  assert.match(migration, /professional\.role IN \('admin', 'super_admin'\)/)
  assert.match(migration, /allowed\.cliente_id = p_cliente_id/)
  assert.match(migration, /'\*\/30 \* \* \* \*'/)
  assert.match(migration, /'\/functions\/v1\/ap-data-ingestion'/)
  assert.match(migration, /cron job targets an unexpected endpoint/)
  assert.match(migration, /cron job lacks required authenticated-worker headers/)
})

test('probe shares the administrative role contract', () => {
  const auth = read('supabase/functions/_shared/editorialAdminAuth.ts')
  assert.match(auth, /authorization\.role !== "admin" && authorization\.role !== "super_admin"/)
})
