import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  new URL('../../supabase/migrations/20260929223000_normalize_instagram_radar_collected_news.sql', import.meta.url),
  'utf8',
)

assert.match(sql, /metadata\s*->>\s*'platform'\s*=\s*'instagram'/)
assert.match(sql, /metadata\s*->>\s*'provider'\s*=\s*'meta_business_discovery'/)
assert.match(sql, /status\s*=\s*'pending_review'/)
assert.match(sql, /UPDATE ap\.collected_news/)
assert.match(sql, /title\s*=\s*normalized\.title/)
assert.match(sql, /excerpt\s*=\s*normalized\.excerpt/)
assert.doesNotMatch(sql, /SET[\s\S]*content\s*=/)
assert.doesNotMatch(sql, /canonical_url\s*=/)
assert.doesNotMatch(sql, /content_hash\s*=/)

console.log('normalize-instagram-radar-collected-news migration contract: PASS')
