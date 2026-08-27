import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

test('browser no longer exposes global AutoPublisher worker execution', () => {
  const source = read('src/pages/admin/AutoPublisher.jsx')
  assert.doesNotMatch(source, /handleForceProcess/)
  assert.doesNotMatch(source, /Processar Tudo/)
  for (const worker of ['ap-image-fetcher', 'ap-scoring-engine', 'ap-daily-feed-builder']) {
    assert.doesNotMatch(source, new RegExp(`functions\\.invoke\\(['"]${worker}`))
  }
  assert.match(source, /action:\s*canPrepareRender\s*\?\s*'process_selected'/)
  assert.match(source, /newsId:\s*item\.id/)
})

test('all browser-inaccessible global workers require the internal credential', () => {
  for (const worker of [
    'ap-data-ingestion',
    'ap-scoring-engine',
    'ap-daily-feed-builder',
    'ap-render-engine',
    'ap-render-recovery',
  ]) {
    const source = read(`supabase/functions/${worker}/index.ts`)
    assert.match(source, /requireTrustedInternalRequest\(req\)/, worker)
  }
})

test('interactive content processing requires an explicit resource', () => {
  const source = read('supabase/functions/ap-content-production/index.ts')
  assert.match(source, /RESOURCE_TARGET_REQUIRED/)
  assert.match(source, /if \(!body\.newsId\)/)
})

test('gateway verification is explicit for every hardened worker', () => {
  const config = read('supabase/config.toml')
  for (const worker of [
    'ap-image-fetcher',
    'ap-data-ingestion',
    'ap-scoring-engine',
    'ap-daily-feed-builder',
    'ap-content-production',
    'ap-render-engine',
    'ap-render-recovery',
  ]) {
    assert.match(config, new RegExp(`\\[functions\\.${worker}\\]\\s+verify_jwt = true`), worker)
  }
})

test('migration grants only the service worker and secures every cron call', () => {
  const migration = read('supabase/migrations/20260819233000_harden_autopublisher_egress_workers.sql')
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON TABLE ap\.worker_telemetry TO service_role/)
  assert.match(migration, /REVOKE ALL ON TABLE ap\.worker_telemetry FROM anon, authenticated/)
  assert.match(migration, /x-ap-internal-secret/)
  assert.match(migration, /ap-image-fetcher/)
  assert.doesNotMatch(migration, /current_setting\s*\(\s*['"]app\.supabase_url/)
})

test('worker telemetry preserves correlation and start/end timestamps without secrets', () => {
  const telemetry = read('supabase/functions/_shared/telemetry.ts')
  assert.match(telemetry, /correlation_id:\s*params\.worker_id/)
  assert.match(telemetry, /started_at:\s*startedAt/)
  assert.match(telemetry, /finished_at:\s*new Date\(\)\.toISOString\(\)/)
  assert.doesNotMatch(telemetry, /authorization|bearer|token|secret/i)
})

test('render cannot transition directly to approved', () => {
  const source = read('supabase/functions/ap-render-engine/index.ts')
  assert.match(source, /status:\s*"pending_review"/)
  assert.doesNotMatch(source, /status:\s*["']approved["']/)
})

test('production scoring, quota and curated-ingestion semantics are preserved', () => {
  const scoring = read('supabase/functions/ap-scoring-engine/index.ts')
  assert.match(scoring, /freshnessScore/)
  assert.match(scoring, /priorityBoost/)
  assert.match(scoring, /learningScore/)
  assert.doesNotMatch(scoring, /base_score:\s*5\.0/)

  const daily = read('supabase/functions/ap-daily-feed-builder/index.ts')
  assert.match(daily, /const QUOTAS/)
  assert.match(daily, /candidate_scores\(score_total\)/)

  const ingestion = read('supabase/functions/ap-data-ingestion/index.ts')
  assert.doesNotMatch(ingestion, /classifyCategory/)
  assert.doesNotMatch(ingestion, /from\(["']candidate_news["']\)\.insert/)
  assert.match(ingestion, /rpc\(["']ingest_collected_news["']/)
  assert.match(ingestion, /destination:\s*"ap\.collected_news"/)
})
