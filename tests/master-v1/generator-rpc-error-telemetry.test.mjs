import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const generator = fs.readFileSync(
  path.join(root, 'supabase/functions/ap-employee-generator/index.ts'),
  'utf8',
)
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260726223133_normalize_candidate_news_url_uniqueness.sql'),
  'utf8',
)

test('candidate RPC conflicts are sanitized and returned as a safe 409', () => {
  assert.match(generator, /raw\.code === '23505'/)
  assert.match(generator, /code: 'DUPLICATE_CANDIDATE'/)
  assert.match(generator, /sanitized_message: sanitizeUnexpectedMessage/)
  assert.match(generator, /return rpcErrorResponse\(/)
})

test('blank candidate URLs stay empty and are excluded from the partial unique index', () => {
  assert.match(migration, /SET url_original = ''/)
  assert.match(migration, /DROP CONSTRAINT IF EXISTS uq_candidate_news_url_cliente/)
  assert.match(migration, /CREATE UNIQUE INDEX uq_candidate_news_client_url_active/)
  assert.match(migration, /NEW\.url_original := COALESCE\(NULLIF\(btrim\(NEW\.url_original\), ''\), ''\)/)
})
