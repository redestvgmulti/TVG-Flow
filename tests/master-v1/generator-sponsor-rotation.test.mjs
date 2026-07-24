import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const CLIENTE = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'
const KEY = '11111111-1111-4111-8111-111111111111'
const TITLE = { id: '22222222-2222-4222-8222-222222222222', formatos: ['feed', 'reels'], ativo: true }
const CONFIG = { id: 'config-feed', enabled: true, master_template_uuid: 'master-feed', layer_map: { visual_title: 'tag-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' } }
const CREATED = { id: '33333333-3333-4333-8333-333333333333', status: 'processing' }

function resolveSponsorCount(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) && [0, 1, 2].includes(parsed) ? parsed : null
}

async function runGeneratorModel({
  sponsorCount,
  idempotencyKey = KEY,
  manualUuid = null,
  title = TITLE,
  config = CONFIG,
  killSwitch = false,
  rpcResult = { reused: false, candidate_news: CREATED },
  claim = true,
  existingCandidate = null,
} = {}) {
  const calls = { legacyTemplateRotation: 0, sponsorRpc: 0, editorial: 0, profileLookup: 0, titleLookup: 0, masterControl: 0, masterConfig: 0 }
  const requested = sponsorCount !== undefined && sponsorCount !== null && sponsorCount !== ''
  if (!requested) {
    calls.legacyTemplateRotation += 1
    calls.profileLookup += 1
    return { mode: 'legacy', calls }
  }
  const count = resolveSponsorCount(sponsorCount)
  if (count === null) throw new Error('SPONSOR_COUNT_INVALID')
  if (!idempotencyKey) throw new Error('IDEMPOTENCY_KEY_REQUIRED')
  if (manualUuid) throw new Error('MANUAL_UUID_UNSUPPORTED')
  if (!existingCandidate) {
    calls.titleLookup += 1
    calls.masterControl += 1
    calls.masterConfig += 1
    if (!title?.ativo || !title?.formatos.includes('feed')) throw new Error('VISUAL_TITLE_INVALID')
    if (killSwitch || !config?.enabled || !config.master_template_uuid || !config.layer_map?.visual_title) throw new Error('MASTER_V1_DISABLED')
  }

  calls.sponsorRpc += 1
  const params = {
    p_cliente_id: CLIENTE,
    p_idempotency_key: idempotencyKey,
    p_content_type: 'feed',
    p_template_set: 'default',
    p_sponsor_count: count,
    p_visual_title_id: title.id,
    p_render_contract_version: 'master_v1',
    p_render_snapshot_base: existingCandidate
      ? {}
      : { master_config: { id: config.id, master_template_uuid: config.master_template_uuid, enabled: true }, layer_map: config.layer_map },
  }
  const news = rpcResult.candidate_news
  if (rpcResult.reused && ['pending_render', 'pending_review', 'approved'].includes(news.status)) return { mode: 'reused_terminal', calls, params }
  if (!claim) return { mode: 'already_processing', calls, params }
  calls.editorial += 1
  return { mode: 'editorial', calls, params }
}

test('legacy clients that omit sponsor_count keep the existing generator path', async () => {
  const actual = await runGeneratorModel()
  assert.equal(actual.mode, 'legacy')
  assert.equal(actual.calls.legacyTemplateRotation, 1)
  assert.equal(actual.calls.sponsorRpc, 0)
})

test('master sponsor requests call only the transacted RPC and preserve its snapshot inputs', async () => {
  const actual = await runGeneratorModel({ sponsorCount: 2 })
  assert.equal(actual.calls.sponsorRpc, 1)
  assert.equal(actual.calls.legacyTemplateRotation, 0)
  assert.equal(actual.calls.profileLookup, 0)
  assert.equal(actual.params.p_sponsor_count, 2)
  assert.equal(actual.params.p_visual_title_id, TITLE.id)
  assert.equal(actual.params.p_render_snapshot_base.master_config.master_template_uuid, 'master-feed')
  assert.equal(actual.params.p_render_snapshot_base.layer_map.visual_title, 'tag-png')
})

test('sponsor_count supports exactly zero, one, and two without slot coupling in the generator', async () => {
  for (const count of [0, 1, 2]) {
    const actual = await runGeneratorModel({ sponsorCount: count })
    assert.equal(actual.params.p_sponsor_count, count)
    assert.equal(actual.calls.sponsorRpc, 1)
  }
})

test('invalid count, missing key, manual UUID, inactive title, kill switch, and invalid config fail before rotation', async () => {
  const cases = [
    [{ sponsorCount: 3 }, 'SPONSOR_COUNT_INVALID'],
    [{ sponsorCount: 1, idempotencyKey: null }, 'IDEMPOTENCY_KEY_REQUIRED'],
    [{ sponsorCount: 1, manualUuid: 'legacy-uuid' }, 'MANUAL_UUID_UNSUPPORTED'],
    [{ sponsorCount: 1, title: { ...TITLE, ativo: false } }, 'VISUAL_TITLE_INVALID'],
    [{ sponsorCount: 1, killSwitch: true }, 'MASTER_V1_DISABLED'],
    [{ sponsorCount: 1, config: { ...CONFIG, master_template_uuid: null } }, 'MASTER_V1_DISABLED'],
  ]
  for (const [input, expected] of cases) await assert.rejects(() => runGeneratorModel(input), new RegExp(expected))
})

test('committed retries do not consult live title, master config or kill switch', async () => {
  const actual = await runGeneratorModel({
    sponsorCount: 1,
    existingCandidate: CREATED,
    title: { ...TITLE, ativo: false },
    config: { ...CONFIG, master_template_uuid: null, layer_map: null },
    killSwitch: true,
    rpcResult: { reused: true, candidate_news: { ...CREATED, status: 'pending_render' } },
  })
  assert.equal(actual.mode, 'reused_terminal')
  assert.deepEqual(
    {
      titleLookup: actual.calls.titleLookup,
      masterControl: actual.calls.masterControl,
      masterConfig: actual.calls.masterConfig,
    },
    { titleLookup: 0, masterControl: 0, masterConfig: 0 },
  )
  assert.deepEqual(actual.params.p_render_snapshot_base, {})
})

test('terminal idempotent retries do not invoke editorial or any rotation again', async () => {
  const actual = await runGeneratorModel({ sponsorCount: 2, existingCandidate: CREATED, rpcResult: { reused: true, candidate_news: { ...CREATED, status: 'pending_render' } } })
  assert.equal(actual.mode, 'reused_terminal')
  assert.equal(actual.calls.sponsorRpc, 1)
  assert.equal(actual.calls.editorial, 0)
  assert.equal(actual.calls.legacyTemplateRotation, 0)
})

test('a concurrent retry with an existing processing claim does not invoke a second editorial workflow', async () => {
  const actual = await runGeneratorModel({ sponsorCount: 1, existingCandidate: CREATED, rpcResult: { reused: true, candidate_news: CREATED }, claim: false })
  assert.equal(actual.mode, 'already_processing')
  assert.equal(actual.calls.editorial, 0)
  assert.equal(actual.calls.sponsorRpc, 1)
})

test('a retry after an interrupted editorial stage may claim the same candidate without re-rotating', async () => {
  const actual = await runGeneratorModel({ sponsorCount: 1, existingCandidate: CREATED, rpcResult: { reused: true, candidate_news: CREATED }, claim: true })
  assert.equal(actual.mode, 'editorial')
  assert.equal(actual.calls.editorial, 1)
  assert.equal(actual.calls.sponsorRpc, 1)
  assert.equal(actual.calls.legacyTemplateRotation, 0)
})

test('implemented generator delegates sponsor rotation to the single database RPC', async () => {
  const source = await readFile(new URL('../../supabase/functions/ap-employee-generator/index.ts', import.meta.url), 'utf8')
  assert.match(source, /sponsor_count: rawSponsorCount/)
  assert.ok(source.includes("rpc('create_candidate_with_sponsors'"))
  assert.match(source, /p_idempotency_key: idempotency_key/)
  assert.match(source, /p_sponsor_count: sponsorCount/)
  assert.match(source, /p_render_contract_version: 'master_v1'/)
  assert.ok(source.includes('if (sponsorCountRequested) {'))
  assert.ok(source.includes('if (!await claimEditorialProcessing(supabase, news.id))'))
})
