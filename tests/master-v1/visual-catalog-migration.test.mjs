import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const structuralUrl = new URL('supabase/migrations/20260802193321_autopublisher_visual_catalog_expansion.sql', root)
const tenantUrl = new URL('supabase/migrations/20260802213527_autopublisher_visual_catalog_operational_tenant.sql', root)
const structural = await readFile(structuralUrl, 'utf8')
const tenant = await readFile(tenantUrl, 'utf8')
const previousCore = await readFile(new URL('supabase/migrations/20260725123000_sponsor_rotation_without_template_rotation.sql', root), 'utf8')
const previousSponsor = await readFile(new URL('supabase/migrations/20260726150000_create_render_sponsor_transactional.sql', root), 'utf8')

function extractFunction(sql, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION ${escaped}\\([\\s\\S]*?\\$function\\$;`))
  assert.ok(match, `${name} definition not found`)
  return match[0]
}

function signature(definition) {
  return definition.match(/CREATE OR REPLACE FUNCTION [^(]+\(([\s\S]*?)\)\s*RETURNS/i)?.[1]
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizedLines(value) {
  return value.replace(/\r\n/g, '\n')
}

test('structural migration contains no live master DML and never alters candidate_news', () => {
  assert.doesNotMatch(structural, /^UPDATE ap\.master_render_configs/gm)
  assert.doesNotMatch(structural, /^INSERT INTO ap\.master_render_configs/gm)
  assert.doesNotMatch(structural, /ALTER TABLE ap\.candidate_news/)
  assert.doesNotMatch(structural, /UPDATE ap\.candidate_news/)
  assert.match(structural, /ADD COLUMN IF NOT EXISTS sponsor_count smallint/)
  assert.match(structural, /'tvg', 'misto', 'tvg_img', 'individual', 'aparecida', 'story'/)
})

test('tenant migration preserves enabled flags and never rewrites template UUIDs', () => {
  const updateStatements = [...tenant.matchAll(/UPDATE ap\.master_render_configs[\s\S]*?;/g)].map(match => match[0])
  assert.ok(updateStatements.length >= 2)
  for (const statement of updateStatements) {
    const setClause = statement.match(/SET([\s\S]*?)(?:\n\s*FROM|\n\s*WHERE)/i)?.[1] || ''
    assert.doesNotMatch(setClause, /enabled\s*=/i)
    assert.doesNotMatch(setClause, /master_template_uuid\s*=/i)
  }
  assert.match(tenant, /ON CONFLICT \(cliente_id, content_type, visual_model\) DO NOTHING/)
})

test('only missing catalog rows are inserted disabled', () => {
  const insertBlock = tenant.match(/INSERT INTO ap\.master_render_configs[\s\S]*?ON CONFLICT/)?.[0] || ''
  const rows = [...insertBlock.matchAll(/'(feed|reels|story)', 'default', '([^']+)', '([^']+)', false, (2|1|NULL),/g)]
  assert.equal(rows.length, 4)
  const counts = new Map(rows.map(row => [`${row[1]}/${row[2]}`, row[4]]))
  assert.equal(counts.get('feed/individual'), '1')
  assert.equal(counts.get('story/story'), '2')
  assert.equal(counts.get('reels/individual'), 'NULL')
  assert.equal(counts.get('reels/aparecida'), 'NULL')
})

test('audited Individual Feed and Story contracts are exact and fixed layers stay out', () => {
  assert.match(tenant, /'4e7pghwb4beji', false, 1,\s*'\{"headline":"titulo-materia","news_image":"news-image","visual_title":"titulo-png","sponsor_1":"patrocinador-2"\}'::jsonb/)
  assert.match(tenant, /'x3djtbqorrtqc', false, 2,\s*'\{"headline":"titulo-materia","visual_title":"titulo-png","sponsor_1":"patrocinador-1","sponsor_2":"patrocinador-2"\}'::jsonb/)
  assert.doesNotMatch(tenant, /"(?:tvg-fixo|shadow-1|shadow-2)"/)
})

test('catalog data is hard-scoped to the operational tenant and collision guarded', () => {
  const tenantId = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'
  assert.ok((tenant.match(new RegExp(tenantId, 'g')) || []).length >= 15)
  assert.doesNotMatch(tenant, /v_cliente_id|count\(DISTINCT cliente_id\)/)
  assert.match(tenant, /MASTER_RENDER_CONFIG_TVG_IMG_COLLISION/)
  assert.match(tenant, /AUTOPUBLISHER_EXISTING_MASTER_UUID_MISMATCH/)
  assert.match(tenant, /AUTOPUBLISHER_NEW_MASTER_SCOPE_COLLISION/)
  assert.match(tenant, /AUTOPUBLISHER_NEW_MASTER_UUID_COLLISION/)
  assert.doesNotMatch(structural, /mzszfje7xdh6l|4e7pghwb4beji/)
})

test('schema changes remain inside the rendering domain', () => {
  const alteredTables = [...structural.matchAll(/ALTER TABLE ap\.([a-z0-9_]+)/gi)].map(match => match[1])
  assert.deepEqual([...new Set(alteredTables)].sort(), [
    'master_render_configs',
    'render_sponsor_rotation_state',
    'render_sponsor_scope_memberships',
    'visual_titles',
  ])
  assert.doesNotMatch(structural, /ALTER TABLE (?:public|auth|storage)\./i)
  assert.doesNotMatch(structural, /CREATE POLICY|DROP POLICY|ENABLE ROW LEVEL SECURITY/i)
  assert.doesNotMatch(tenant, /ALTER TABLE|CREATE (?:UNIQUE )?INDEX/i)
})

test('candidate history and frozen snapshots are never rewritten', () => {
  assert.doesNotMatch(structural, /ALTER TABLE ap\.candidate_news/i)
  assert.doesNotMatch(structural, /^UPDATE ap\.candidate_news/gm)
  assert.doesNotMatch(tenant, /(?:INSERT INTO|UPDATE|ALTER TABLE) ap\.candidate_news/i)
  assert.doesNotMatch(tenant, /render_snapshot|DELETE FROM ap\./i)
})

test('Story receives constraints, transactional membership and the same snapshot RPC', () => {
  assert.match(structural, /formatos <@ ARRAY\['feed', 'reels', 'story'\]/)
  assert.match(structural, /IF v_content_type NOT IN \('feed', 'reels', 'story'\) THEN/)
  assert.match(structural, /FOREACH v_format IN ARRAY ARRAY\['feed', 'reels', 'story'\]/)
  assert.match(structural, /CREATE OR REPLACE FUNCTION ap\.create_candidate_with_sponsors_core_v1/)
  assert.match(structural, /CREATE OR REPLACE FUNCTION ap\.create_render_sponsor/)
})

test('structural migration is ordered before the operational tenant migration', () => {
  assert.ok(
    structuralUrl.pathname.split('/').at(-1) < tenantUrl.pathname.split('/').at(-1),
  )
})

test('candidate RPC is byte-equivalent after normalizing only the Story format addition', () => {
  const before = extractFunction(previousCore, 'ap.create_candidate_with_sponsors_core_v1')
  const after = extractFunction(structural, 'ap.create_candidate_with_sponsors_core_v1')
  assert.equal(signature(after), signature(before))
  assert.equal(
    normalizedLines(after.replace("('feed', 'reels', 'story')", "('feed', 'reels')")),
    normalizedLines(before),
  )
  assert.match(after, /SECURITY DEFINER\s+SET search_path = pg_catalog/)
  assert.match(after, /pg_advisory_xact_lock/)
  assert.match(after, /FOR UPDATE/)
  assert.match(after, /v_cursor_before := v_cursor_stored % v_pool_size/)
  assert.match(after, /IDEMPOTENCY_KEY_PAYLOAD_MISMATCH/)
})

test('sponsor registration RPC is byte-equivalent after normalizing only Story membership', () => {
  const before = extractFunction(previousSponsor, 'ap.create_render_sponsor')
  const after = extractFunction(structural, 'ap.create_render_sponsor')
  assert.equal(signature(after), signature(before))
  assert.equal(
    normalizedLines(after
      .replace('All supported formats, always.', 'Both formats, always.')
      .replace("ARRAY['feed', 'reels', 'story']", "ARRAY['feed', 'reels']")),
    normalizedLines(before),
  )
  assert.match(after, /SECURITY DEFINER\s+SET search_path = pg_catalog/)
  assert.match(structural, /REVOKE ALL ON FUNCTION ap\.create_render_sponsor\([\s\S]*?FROM PUBLIC, anon;/)
  assert.match(structural, /GRANT EXECUTE ON FUNCTION ap\.create_render_sponsor\([\s\S]*?TO authenticated, service_role;/)
})
