import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const CLIENTE = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'
const TEMPLATE = {
  id: 'template-real',
  placid_template_uuid: 'legacy-template-uuid',
  ordem: 7,
  nome: 'Eventos A',
  template_set: 'events',
}
const TITLE = {
  id: 'title-1', nome: 'Eventos', slug: 'eventos',
  asset_bucket: 'ap-images', asset_path: 'visual-titles/x/eventos/a.png',
  asset_version: 'a', sha256: 'a'.repeat(64), formatos: ['feed', 'reels'], ativo: true,
}
const MASTER = {
  id: 'master-feed', enabled: true, master_template_uuid: 'master-feed-uuid',
  layer_map: { visual_title: 'tag-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' },
}

function profile(slots = {}) { return { profile_version: 'v1', ativo: true, other_slots: slots } }
function titleSnapshot(title) {
  return title ? { id: title.id, nome: title.nome, slug: title.slug, bucket: title.asset_bucket, path: title.asset_path, version: title.asset_version, sha256: title.sha256 } : null
}

/** A fully mocked data boundary around the decision logic used by ap-employee-generator. */
async function resolveGenerator({
  rpcResult = TEMPLATE,
  manualUuid = null,
  manualRows = [],
  title = TITLE,
  contentType = 'feed',
  config = MASTER,
  control = { kill_switch: false },
  renderProfile = profile(),
  requireProfile = true,
} = {}) {
  const calls = { rpc: 0, templateByUuid: 0, renderer: 0 }
  let resolved
  if (manualUuid) {
    calls.templateByUuid += 1
    if (manualRows.length === 1) resolved = manualRows[0]
    else resolved = { id: null, placid_template_uuid: manualUuid, ordem: null, nome: null, template_set: 'default' }
  } else {
    calls.rpc += 1
    resolved = rpcResult
  }
  if (!resolved?.placid_template_uuid) throw new Error('TEMPLATE_NOT_FOUND')
  if (title && (!title.ativo || !title.formatos.includes(contentType))) throw new Error(!title.ativo ? 'VISUAL_TITLE_INACTIVE' : 'VISUAL_TITLE_FORMAT')
  const visualTitle = titleSnapshot(title)
  const hasRequiredProfile = !requireProfile || Boolean(renderProfile)
  const validMaster = Boolean(!control.kill_switch && config?.enabled && config.master_template_uuid && config.layer_map?.visual_title && visualTitle && resolved.id && hasRequiredProfile)
  const fallback = validMaster ? null : control.kill_switch ? 'kill_switch' : !config?.enabled ? 'master_disabled' : !config?.master_template_uuid ? 'master_uuid_missing' : !config?.layer_map?.visual_title ? 'master_config_invalid' : !visualTitle ? 'visual_title_missing' : !resolved.id ? 'template_row_unresolved' : !hasRequiredProfile ? 'profile_missing' : 'master_config_invalid'
  const slots = { ...(renderProfile?.other_slots || {}) }
  return {
    calls,
    resolved,
    statusBeforeEditorial: 'processing',
    statusAfterEditorial: 'pending_render',
    snapshot: {
      render_contract_version: validMaster ? 'master_v1' : 'legacy',
      template_id: resolved.id,
      legacy_placid_template_uuid: resolved.placid_template_uuid,
      template_nome_snapshot: resolved.nome,
      template_ordem: resolved.ordem,
      template_set_requested: manualUuid ? 'default' : 'events',
      template_set_effective: resolved.template_set || 'events',
      visual_title: visualTitle,
      sponsor_profile: renderProfile ? { profile_version: renderProfile.profile_version, slots } : null,
      layer_map: config?.layer_map || null,
      master_config: config ? { id: config.id, master_template_uuid: config.master_template_uuid, enabled: config.enabled } : null,
      fallback_reason: fallback,
    },
  }
}

test('automatic rotation preserves the complete RPC row, invokes RPC once, and does not look up UUID again', async () => {
  const actual = await resolveGenerator()
  assert.equal(actual.calls.rpc, 1)
  assert.equal(actual.calls.templateByUuid, 0)
  assert.deepEqual(actual.resolved, TEMPLATE)
  assert.equal(actual.snapshot.template_id, TEMPLATE.id)
  assert.equal(actual.snapshot.legacy_placid_template_uuid, TEMPLATE.placid_template_uuid)
  assert.equal(actual.snapshot.template_set_requested, 'events')
  assert.equal(actual.snapshot.template_set_effective, 'events')
  assert.equal(actual.calls.renderer, 0)
  assert.equal(actual.statusBeforeEditorial, 'processing')
  assert.equal(actual.statusAfterEditorial, 'pending_render')
})

test('a unique manual UUID resolves the scoped template row', async () => {
  const row = { ...TEMPLATE, id: 'manual-real', placid_template_uuid: 'manual-uuid', template_set: 'default' }
  const actual = await resolveGenerator({ manualUuid: 'manual-uuid', manualRows: [row] })
  assert.equal(actual.calls.rpc, 0)
  assert.equal(actual.calls.templateByUuid, 1)
  assert.equal(actual.snapshot.template_id, 'manual-real')
  assert.equal(actual.snapshot.legacy_placid_template_uuid, 'manual-uuid')
})

test('an ambiguous manual UUID preserves only the legacy UUID and falls back', async () => {
  const actual = await resolveGenerator({ manualUuid: 'duplicate-uuid', manualRows: [{ ...TEMPLATE }, { ...TEMPLATE, id: 'other' }] })
  assert.equal(actual.snapshot.template_id, null)
  assert.equal(actual.snapshot.legacy_placid_template_uuid, 'duplicate-uuid')
  assert.equal(actual.snapshot.render_contract_version, 'legacy')
  assert.equal(actual.snapshot.fallback_reason, 'template_row_unresolved')
})

test('valid visual title is snapshot with immutable asset identity', async () => {
  const actual = await resolveGenerator()
  assert.deepEqual(actual.snapshot.visual_title, {
    id: TITLE.id, nome: TITLE.nome, slug: TITLE.slug, bucket: TITLE.asset_bucket,
    path: TITLE.asset_path, version: TITLE.asset_version, sha256: TITLE.sha256,
  })
})

test('inactive and format-incompatible visual titles are rejected', async () => {
  await assert.rejects(() => resolveGenerator({ title: { ...TITLE, ativo: false } }), /VISUAL_TITLE_INACTIVE/)
  await assert.rejects(() => resolveGenerator({ title: { ...TITLE, formatos: ['reels'] }, contentType: 'feed' }), /VISUAL_TITLE_FORMAT/)
})

test('missing, disabled, kill-switched, UUID-less, or title-less master configs remain legacy', async () => {
  const cases = [
    [{ config: null }, 'master_disabled'],
    [{ config: { ...MASTER, enabled: false } }, 'master_disabled'],
    [{ control: { kill_switch: true } }, 'kill_switch'],
    [{ config: { ...MASTER, master_template_uuid: null } }, 'master_uuid_missing'],
    [{ title: null }, 'visual_title_missing'],
  ]
  for (const [input, reason] of cases) {
    const actual = await resolveGenerator(input)
    assert.equal(actual.snapshot.render_contract_version, 'legacy')
    assert.equal(actual.snapshot.fallback_reason, reason)
  }
})

test('missing profile is legacy only when the contract requires it', async () => {
  const actual = await resolveGenerator({ renderProfile: null, requireProfile: true })
  assert.equal(actual.snapshot.render_contract_version, 'legacy')
  assert.equal(actual.snapshot.fallback_reason, 'profile_missing')
})

test('sponsor slots are independent: sponsor_2 alone is valid and never becomes sponsor_1', async () => {
  const sponsor2 = { bucket: 'ap-images', path: 'sponsors/x/b.png', version: 'b', sha256: 'b'.repeat(64), nome: 'B' }
  const actual = await resolveGenerator({ renderProfile: profile({ sponsor_1: null, sponsor_2: sponsor2 }) })
  assert.equal(actual.snapshot.render_contract_version, 'master_v1')
  assert.equal(actual.snapshot.sponsor_profile.slots.sponsor_1, null)
  assert.deepEqual(actual.snapshot.sponsor_profile.slots.sponsor_2, sponsor2)
  assert.equal(Object.hasOwn(actual.snapshot.sponsor_profile.slots, 'sponsor_1'), true)
})

test('sponsor_1 alone and no sponsors both remain valid', async () => {
  const sponsor1 = { bucket: 'ap-images', path: 'sponsors/x/a.png' }
  const one = await resolveGenerator({ renderProfile: profile({ sponsor_1: sponsor1 }) })
  const none = await resolveGenerator({ renderProfile: profile({}) })
  assert.equal(one.snapshot.render_contract_version, 'master_v1')
  assert.deepEqual(one.snapshot.sponsor_profile.slots.sponsor_1, sponsor1)
  assert.equal(one.snapshot.sponsor_profile.slots.sponsor_2, undefined)
  assert.equal(none.snapshot.render_contract_version, 'master_v1')
  assert.deepEqual(none.snapshot.sponsor_profile.slots, {})
})

test('the implemented generator keeps automatic rotation as a single RPC source of truth', async () => {
  const source = await readFile(new URL('../../supabase/functions/ap-employee-generator/index.ts', import.meta.url), 'utf8')
  assert.match(source, /resolved = await rotateTemplate\(supabase, ownerId, content_type, requestedSet\)/)
  assert.match(source, /template_id: resolved\.id/)
  assert.match(source, /legacy_placid_template_uuid: resolved\.placid_template_uuid/)
  assert.match(source, /render_contract_version: canMaster \? "master_v1" : "legacy"/)
  assert.doesNotMatch(source, /rotateTemplate\([^\n]+\)[\s\S]{0,250}placid_template_uuid\)\.maybeSingle/)
})