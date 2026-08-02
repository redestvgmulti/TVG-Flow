import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { prepareRotationV1Render } from '../../supabase/functions/ap-render-engine/renderContract.ts'

const root = new URL('../../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')
const SUPABASE_URL = 'https://tenant.supabase.co'
const MATRIX = [
  { contentType: 'feed', visualModel: 'tvg', uuid: 'mzszfje7xdh6l', sponsors: 2, audited: true },
  { contentType: 'reels', visualModel: 'tvg', uuid: 'xcxtk9tt7syfd', sponsors: 2, audited: true },
  { contentType: 'feed', visualModel: 'tvg_img', uuid: '3pm4re4blrizh', sponsors: 1, audited: true },
  { contentType: 'reels', visualModel: 'tvg_img', uuid: 'rrbcykdqcrqae', sponsors: 1, audited: true },
  { contentType: 'feed', visualModel: 'individual', uuid: '4e7pghwb4beji', sponsors: 1, audited: true },
  { contentType: 'reels', visualModel: 'individual', uuid: '5wtiafeuc52hi', sponsors: null },
  { contentType: 'story', visualModel: 'story', uuid: 'x3djtbqorrtqc', sponsors: 2, audited: true },
  { contentType: 'reels', visualModel: 'aparecida', uuid: '91gsgmxj1irqh', sponsors: null },
]
const FEED_LAYERS = { headline: 'titulo-materia', news_image: 'news-image', visual_title: 'titulo-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' }
const REELS_LAYERS = { headline: 'titulo-materia', visual_title: 'titulo-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' }
const INDIVIDUAL_FEED_LAYERS = { headline: 'titulo-materia', news_image: 'news-image', visual_title: 'titulo-png', sponsor_1: 'patrocinador-2' }
const STORY_LAYERS = { headline: 'titulo-materia', visual_title: 'titulo-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' }
const sha = char => char.repeat(64)
const sponsorAsset = (slot, name) => ({ slot, sponsor_id: `sponsor-${name}`, bucket: 'ap-images', path: `sponsors/${name}.png`, version: 'v1', sha256: sha(name) })

function candidate(row, visualModel = row.visualModel) {
  const items = row.sponsors > 0 ? [sponsorAsset('sponsor_1', 'a')] : []
  if (row.sponsors === 2) items.push(sponsorAsset('sponsor_2', 'b'))
  return {
    id: 'news-1', cliente_id: 'cliente-1', content_type: row.contentType,
    headline: 'Novo viaduto é inaugurado', context_tag: 'URGENTE',
    imagem_url: row.contentType === 'feed' ? 'https://cdn.test/news.jpg' : null,
    sponsor_count: row.sponsors, render_contract_version: 'master_v1',
    render_snapshot: {
      render_contract_version: 'master_v1', sponsor_source: 'rotation_v1', visual_model: visualModel,
      master_config: { master_template_uuid: row.uuid, visual_model: visualModel, sponsor_count: row.sponsors },
      layer_map: row.uuid === '4e7pghwb4beji'
        ? INDIVIDUAL_FEED_LAYERS
        : row.uuid === 'x3djtbqorrtqc'
          ? STORY_LAYERS
          : row.contentType === 'feed' ? FEED_LAYERS : REELS_LAYERS,
      visual_title: { bucket: 'ap-images', path: 'visual-titles/noticias.png', version: 'v1', sha256: sha('c') },
      sponsor_selection: { rotation_version: 'sponsor_rotation_v1', requested_count: row.sponsors, items },
    },
  }
}

for (const row of MATRIX.filter(row => row.audited)) {
  test(`${row.visualModel}/${row.contentType} resolves frozen ${row.uuid}`, () => {
    const plan = prepareRotationV1Render(candidate(row), SUPABASE_URL)
    assert.equal(plan.templateId, row.uuid)
  })
}

const EXISTING_PRESET_RENDER_CONTRACTS = [
  {
    name: 'TVG Feed',
    row: MATRIX[0],
    layers: ['news-image', 'patrocinador-1', 'patrocinador-2', 'titulo-materia', 'titulo-png'],
  },
  {
    name: 'TVG Reels',
    row: MATRIX[1],
    layers: ['patrocinador-1', 'patrocinador-2', 'titulo-materia', 'titulo-png'],
  },
  {
    name: 'TVG + IMG Feed',
    row: MATRIX[2],
    layers: ['news-image', 'patrocinador-1', 'titulo-materia', 'titulo-png'],
  },
  {
    name: 'TVG + IMG Reels',
    row: MATRIX[3],
    layers: ['patrocinador-1', 'titulo-materia', 'titulo-png'],
  },
]

for (const contract of EXISTING_PRESET_RENDER_CONTRACTS) {
  test(`${contract.name} keeps its historical UUID, sponsor count and rendered layers`, () => {
    const plan = prepareRotationV1Render(candidate(contract.row), SUPABASE_URL)
    assert.equal(plan.templateId, contract.row.uuid)
    assert.equal(contract.row.sponsors, contract.row.visualModel === 'tvg' ? 2 : 1)
    assert.deepEqual(Object.keys(plan.layers).sort(), [...contract.layers].sort())
  })
}

test('migration contains exactly the eight approved UUIDs and no alternate Aparecida UUID', async () => {
  const migration = await source('supabase/migrations/20260802213527_autopublisher_visual_catalog_operational_tenant.sql')
  for (const row of MATRIX) assert.match(migration, new RegExp(row.uuid))
  const catalogValues = new Set(
    [...migration.matchAll(/'([a-z0-9]{13})'/g)].map(match => match[1]),
  )
  assert.deepEqual([...catalogValues].sort(), MATRIX.map(row => row.uuid).sort())
})

test('uninspected Individual Reels and Aparecida presets stay disabled and unresolved', async () => {
  const migration = await source('supabase/migrations/20260802213527_autopublisher_visual_catalog_operational_tenant.sql')
  for (const row of MATRIX.filter(row => !row.audited)) {
    const escaped = row.uuid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(migration, new RegExp(`'${escaped}', false, NULL, '\\{\\}'::jsonb`))
  }
})

test('two slots still require distinct sponsors and a unit pool still serves one slot', () => {
  const tvg = prepareRotationV1Render(candidate(MATRIX[0]), SUPABASE_URL)
  assert.notEqual(tvg.layers['patrocinador-1'].image, tvg.layers['patrocinador-2'].image)
  const tvgImg = prepareRotationV1Render(candidate(MATRIX[2]), SUPABASE_URL)
  assert.equal(candidate(MATRIX[2]).render_snapshot.sponsor_selection.items.length, 1)
  assert.ok(tvgImg.layers['patrocinador-1'])
  assert.equal(tvgImg.layers['patrocinador-2'], undefined)
})

test('Individual Feed maps logical sponsor_1 to its only physical patrocinador-2 slot', () => {
  const plan = prepareRotationV1Render(candidate(MATRIX[4]), SUPABASE_URL)
  assert.ok(plan.layers['patrocinador-2'])
  assert.equal(plan.layers['patrocinador-1'], undefined)
  assert.ok(plan.layers['news-image'])
  assert.equal(plan.layers['tvg-fixo'], undefined)
  assert.equal(plan.layers['shadow-1'], undefined)
  assert.equal(plan.layers['shadow-2'], undefined)
})

test('headline is text, visual title is image and fixed layers are omitted', () => {
  const plan = prepareRotationV1Render(candidate(MATRIX[0]), SUPABASE_URL)
  assert.deepEqual(plan.layers['titulo-materia'], { text: 'Novo viaduto é inaugurado' })
  assert.match(plan.layers['titulo-png'].image, /visual-titles\/noticias\.png$/)
  assert.equal(plan.layers['tvg-fixo'], undefined)
})

test('historical misto snapshot remains renderable but new requests reject it', async () => {
  const plan = prepareRotationV1Render(candidate(MATRIX[2], 'misto'), SUPABASE_URL)
  assert.equal(plan.templateId, '3pm4re4blrizh')
  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /historicalMistoRetry && !existingCandidate/)
  assert.match(generator, /VISUAL_MODEL_INVALID/)
})

test('Story uses two distinct sponsors and never sends source image or fixed layers', () => {
  const row = MATRIX[6]
  const item = candidate(row)
  const plan = prepareRotationV1Render(item, SUPABASE_URL)
  assert.equal(plan.templateId, row.uuid)
  assert.equal(plan.layers['news-image'], undefined)
  assert.notEqual(plan.layers['patrocinador-1'].image, plan.layers['patrocinador-2'].image)
  assert.equal(plan.layers['tvg-fixo'], undefined)
  assert.equal(plan.layers['shadow-1'], undefined)
  assert.equal(plan.layers['shadow-2'], undefined)
})

test('frontend payloads never carry UUID, sponsor_count or layer_map', async () => {
  for (const file of ['src/pages/admin/AutoPublisher.jsx', 'src/pages/admin/EmployeeMode.jsx']) {
    const code = await source(file)
    const payloadBlock = [...code.matchAll(/const payload = \{[\s\S]*?\n\s*\};?/gi)]
      .map(match => match[0])
      .find(block => block.includes('visual_title_id')) || ''
    assert.match(payloadBlock, /headline:/)
    assert.match(payloadBlock, /text:/)
    assert.match(payloadBlock, /source_image:/)
    assert.doesNotMatch(payloadBlock, /placid_template_uuid|master_template_uuid|sponsor_count|layer_map|template_set/)
  }
})
