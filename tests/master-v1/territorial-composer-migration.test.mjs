import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')

const files = {
  contract: 'supabase/migrations/20260804200000_autopublisher_territorial_composer_contract.sql',
  rotation: 'supabase/migrations/20260804201000_autopublisher_territorial_rotation_reservations.sql',
  rls: 'supabase/migrations/20260804202000_autopublisher_territorial_composer_rls.sql',
  rpc: 'supabase/migrations/20260804203000_autopublisher_territorial_composer_rpcs.sql',
}

test('composer feature is independently tenant-scoped and disabled by default', async () => {
  const [contract, rpc] = await Promise.all([read(files.contract), read(files.rpc)])
  assert.match(contract, /CREATE TABLE ap\.territorial_composer_features/)
  assert.match(contract, /enabled boolean NOT NULL DEFAULT false/)
  assert.match(rpc, /TERRITORIAL_COMPOSER_DISABLED/)
  assert.match(rpc, /membership\.cliente_id = p_cliente_id/)
  assert.match(rpc, /membership\.profissional_id = v_user_id/)
  assert.doesNotMatch(contract, /DEFAULT true/)
})

test('one active template per tenant and format freezes a validated logical layer map', async () => {
  const contract = await read(files.contract)
  assert.match(contract, /UNIQUE INDEX uq_territorial_composer_template_active_format/)
  assert.match(contract, /ON ap\.territorial_composer_templates \(cliente_id, content_type\)/)
  assert.match(contract, /WHERE ativo/)
  assert.match(contract, /p_content_type = 'story'[\s\S]*NOT \(p_layer_map \? 'visual_title'\)/)
  assert.match(contract, /p_content_type IN \('feed', 'reels'\)[\s\S]*p_layer_map \? 'visual_title'/)
  assert.match(contract, /content_type IN \([\s\S]*'story'[\s\S]*'carousel'[\s\S]*'sponsored'/)
  assert.match(contract, /render_contract_version IN \([\s\S]*'legacy'[\s\S]*'master_v1'[\s\S]*'territorial_composer_v1'/)
})

test('new rotation is isolated from legacy state and locked by region plus format', async () => {
  const [rotation, rpc] = await Promise.all([read(files.rotation), read(files.rpc)])
  assert.match(rotation, /CREATE TABLE ap\.territorial_sponsor_rotation_state/)
  assert.match(rotation, /UNIQUE \(cliente_id, region_id, content_type\)/)
  assert.match(rotation, /status IN \('reserved', 'committed', 'released'\)/)
  assert.match(rotation, /selected_sponsor_ids uuid\[\]/)
  assert.match(rpc, /FROM ap\.territorial_sponsor_rotation_state AS state[\s\S]*FOR UPDATE/)
  assert.match(rpc, /reservation\.status IN \('reserved', 'committed'\)/)
  assert.match(rpc, /ORDER BY link\.created_at, link\.id/)
  assert.doesNotMatch(rotation, /ALTER TABLE ap\.render_sponsor_rotation_state/)
})

test('RPC resolves all trusted data again and snapshots only immutable server values', async () => {
  const rpc = await read(files.rpc)
  assert.match(rpc, /FROM ap\.territorial_composer_templates AS config/)
  assert.match(rpc, /FROM ap\.territorial_regions AS region/)
  assert.match(rpc, /FROM ap\.territorial_cities AS city/)
  assert.match(rpc, /FROM ap\.visual_titles AS title/)
  assert.match(rpc, /FROM ap\.render_sponsors AS sponsor/)
  assert.match(rpc, /'render_contract_version', 'territorial_composer_v1'/)
  assert.match(rpc, /'layer_map', v_template\.layer_map/)
  assert.match(rpc, /'reservation_id', v_reservation_id/)
  assert.doesNotMatch(rpc, /p_template_uuid|p_layer_map|p_sponsor_ids|p_region_image/)
})

test('template and layer map selection cannot cross tenant or format boundaries', async () => {
  const rpc = await read(files.rpc)
  assert.match(
    rpc,
    /FROM ap\.territorial_composer_templates AS config[\s\S]*?WHERE config\.cliente_id = p_cliente_id[\s\S]*?AND config\.content_type = v_content_type[\s\S]*?AND config\.ativo/,
  )
  assert.doesNotMatch(rpc, /p_template_uuid|p_layer_map/)
})

test('least privilege denies anon and grants browser execution only to catalog and create', async () => {
  const rls = await read(files.rls)
  const rpc = await read(files.rpc)
  assert.match(rls, /REVOKE ALL ON TABLE[\s\S]*FROM PUBLIC, anon, authenticated, service_role/)
  assert.match(rls, /TO authenticated, service_role/)
  assert.doesNotMatch(rls, /USING\s*\(\s*true\s*\)/i)
  assert.doesNotMatch(rls, /GRANT ALL/i)
  assert.match(rpc, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/)
  assert.match(rpc, /GRANT EXECUTE ON FUNCTION[\s\S]*get_territorial_composer_catalog[\s\S]*TO authenticated/)
  assert.match(rpc, /GRANT EXECUTE ON FUNCTION[\s\S]*create_territorial_composer_candidate[\s\S]*TO authenticated/)
  assert.match(rpc, /GRANT EXECUTE ON FUNCTION[\s\S]*complete_territorial_composer_render[\s\S]*TO service_role/)
})

test('migrations are additive and never rewrite historical candidates or old configs', async () => {
  const combined = (await Promise.all(Object.values(files).map(read))).join('\n')
  assert.doesNotMatch(combined, /DROP TABLE|TRUNCATE|DELETE FROM ap\.candidate_news/i)
  const snapshotUpdates = [
    ...combined.matchAll(/UPDATE ap\.candidate_news(?:\s+AS\s+\w+)?[\s\S]*?;/gi),
  ].map(match => match[0]).filter(statement => /render_snapshot\s*=/.test(statement))
  for (const statement of snapshotUpdates) {
    assert.match(statement, /WHERE candidate\.id = p_candidate_id/i)
  }
  assert.doesNotMatch(combined, /UPDATE ap\.master_render_configs/i)
  assert.doesNotMatch(combined, /UPDATE ap\.render_sponsor_rotation_state/i)
  assert.doesNotMatch(combined, /ALTER TABLE ap\.candidate_news[\s\S]*ALTER COLUMN[\s\S]*SET NOT NULL/i)
})
