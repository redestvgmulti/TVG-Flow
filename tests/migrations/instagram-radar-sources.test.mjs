import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL('../../supabase/migrations/20260927171120_instagram_radar_sources.sql', import.meta.url)

test('Instagram Radar migration changes only the two source type contracts', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /DROP CONSTRAINT IF EXISTS sources_tipo_check/)
  assert.match(migration, /DROP CONSTRAINT IF EXISTS sources_detected_type_check/)
  for (const type of ['auto', 'website', 'rss', 'atom', 'google_news_rss', 'sitemap', 'instagram']) {
    assert.match(migration, new RegExp(`'${type}'`))
  }
  assert.match(migration, /detected_type IS NULL OR detected_type IN/)
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE|CREATE TABLE|CREATE FUNCTION|ALTER COLUMN)\b/i)
})
