import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { sponsorCountForVisualModel } from '../../src/services/visualModels.js'
import { prepareRotationV1Render } from '../../supabase/functions/ap-render-engine/renderContract.ts'

const root = new URL('../../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')
const SUPABASE_URL = 'https://tenant.supabase.co'

// The four fixed templates. These UUIDs live in ap.master_render_configs only;
// this table is the single place a test is allowed to restate them.
const MATRIX = [
  { contentType: 'feed', visualModel: 'tvg', uuid: 'mzszfje7xdh6l', sponsors: 2 },
  { contentType: 'reels', visualModel: 'tvg', uuid: 'xcxtk9tt7syfd', sponsors: 2 },
  { contentType: 'feed', visualModel: 'misto', uuid: '3pm4re4blrizh', sponsors: 1 },
  { contentType: 'reels', visualModel: 'misto', uuid: 'rrbcykdqcrqae', sponsors: 1 },
]

const FEED_LAYERS = {
  headline: 'titulo-materia',
  news_image: 'news-image',
  visual_title: 'titulo-png',
  sponsor_1: 'patrocinador-1',
  sponsor_2: 'patrocinador-2',
}
const REELS_LAYERS = {
  headline: 'titulo-materia',
  visual_title: 'titulo-png',
  sponsor_1: 'patrocinador-1',
  sponsor_2: 'patrocinador-2',
}

const sha = char => char.repeat(64)
const sponsorAsset = (slot, name) => ({
  slot,
  sponsor_id: `sponsor-${name}`,
  bucket: 'ap-images',
  path: `sponsors/${name}.png`,
  version: 'v1',
  sha256: sha(name === 'a' ? 'a' : 'b'),
})

function candidate({ contentType, visualModel, uuid, sponsors }) {
  const items = [sponsorAsset('sponsor_1', 'a')]
  if (sponsors === 2) items.push(sponsorAsset('sponsor_2', 'b'))
  return {
    id: 'news-1',
    cliente_id: 'cliente-1',
    content_type: contentType,
    headline: 'Novo viaduto é inaugurado',
    context_tag: 'URGENTE',
    imagem_url: contentType === 'feed' ? 'https://cdn.test/news.jpg' : null,
    sponsor_count: sponsors,
    render_contract_version: 'master_v1',
    render_snapshot: {
      render_contract_version: 'master_v1',
      sponsor_source: 'rotation_v1',
      visual_model: visualModel,
      master_config: { master_template_uuid: uuid, visual_model: visualModel },
      layer_map: contentType === 'reels' ? REELS_LAYERS : FEED_LAYERS,
      visual_title: {
        bucket: 'ap-images',
        path: 'visual-titles/noticias.png',
        version: 'v1',
        sha256: sha('c'),
      },
      sponsor_selection: {
        rotation_version: 'sponsor_rotation_v1',
        requested_count: sponsors,
        items,
      },
    },
  }
}

for (const row of MATRIX) {
  test(`${row.visualModel} + ${row.contentType} resolve ${row.uuid} com ${row.sponsors} patrocinador(es)`, () => {
    const plan = prepareRotationV1Render(candidate(row), SUPABASE_URL)
    assert.equal(plan.templateId, row.uuid)
    assert.equal(sponsorCountForVisualModel(row.visualModel), row.sponsors)
  })
}

test('Feed nunca resolve um UUID de Reels e Reels nunca resolve um de Feed', () => {
  const byFormat = uuids => new Set(uuids)
  const feedUuids = byFormat(
    MATRIX.filter(r => r.contentType === 'feed').map(r => r.uuid),
  )
  const reelsUuids = byFormat(
    MATRIX.filter(r => r.contentType === 'reels').map(r => r.uuid),
  )
  // The four UUIDs are pairwise distinct, so no format can borrow the other's.
  assert.equal(feedUuids.size + reelsUuids.size, 4)
  for (const uuid of feedUuids) assert.ok(!reelsUuids.has(uuid))

  for (const row of MATRIX) {
    const plan = prepareRotationV1Render(candidate(row), SUPABASE_URL)
    const foreign = row.contentType === 'feed' ? reelsUuids : feedUuids
    assert.ok(!foreign.has(plan.templateId))
  }
})

test('Misto envia apenas patrocinador-1 e omite patrocinador-2', () => {
  for (const row of MATRIX.filter(r => r.visualModel === 'misto')) {
    const plan = prepareRotationV1Render(candidate(row), SUPABASE_URL)
    assert.match(plan.layers['patrocinador-1'].image, /sponsors\/a\.png$/)
    assert.equal(plan.layers['patrocinador-2'], undefined)
    assert.ok(!Object.keys(plan.layers).includes('patrocinador-2'))
  }
})

test('TVG envia patrocinador-1 e patrocinador-2 consecutivos, sem promoção de slot', () => {
  for (const row of MATRIX.filter(r => r.visualModel === 'tvg')) {
    const plan = prepareRotationV1Render(candidate(row), SUPABASE_URL)
    assert.match(plan.layers['patrocinador-1'].image, /sponsors\/a\.png$/)
    assert.match(plan.layers['patrocinador-2'].image, /sponsors\/b\.png$/)
  }
})

test('headline vai para titulo-materia e o selo para titulo-png', () => {
  for (const row of MATRIX) {
    const plan = prepareRotationV1Render(candidate(row), SUPABASE_URL)
    assert.deepEqual(plan.layers['titulo-materia'], {
      text: 'Novo viaduto é inaugurado',
    })
    assert.match(plan.layers['titulo-png'].image, /visual-titles\/noticias\.png$/)
    // The seal is an image layer and must never leak into the headline layer.
    assert.equal(plan.layers['titulo-materia'].image, undefined)
    assert.equal(plan.layers['titulo-png'].text, undefined)
  }
})

test('o selo e seu grupo não alteram o template resolvido', () => {
  const row = MATRIX[0]
  const first = prepareRotationV1Render(candidate(row), SUPABASE_URL)

  const other = candidate(row)
  other.render_snapshot.visual_title = {
    bucket: 'ap-images',
    path: 'visual-titles/esportes.png',
    version: 'v9',
    sha256: sha('d'),
  }
  const second = prepareRotationV1Render(other, SUPABASE_URL)

  assert.equal(first.templateId, second.templateId)
  assert.notEqual(first.layers['titulo-png'].image, second.layers['titulo-png'].image)
})

test('o produtor deriva sponsor_count do modelo e rejeita o enviado pelo cliente', async () => {
  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /VISUAL_MODEL_SPONSORS: Record<string, number> = \{ tvg: 2, misto: 1 \}/)
  assert.match(generator, /const effectiveSponsorCount = usesVisualModel \? sponsorCountForVisualModel\(visualModel\)/)
  assert.match(generator, /p_sponsor_count: effectiveSponsorCount/)
  // Sending both is a validation error, never a silent precedence rule.
  assert.match(generator, /usesVisualModel && sponsorCountRequested/)
  assert.match(generator, /sponsor_count e derivado do visual_model/)
  // The UUID is read from the database only, scoped by visual_model.
  assert.match(generator, /\.eq\('visual_model', visualModel\)/)
  assert.match(generator, /placid_template_uuid manual nao e compativel/)
})

test('a rotação de patrocinadores é compartilhada: template_set fica fixo em default', async () => {
  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /const ROTATION_TEMPLATE_SET = "default"/)
  assert.match(generator, /usesVisualModel \? ROTATION_TEMPLATE_SET/)

  const migration = await source(
    'supabase/migrations/20260725120000_master_render_config_visual_model.sql',
  )
  // The rotation tables must not gain a visual_model dimension: strip comment
  // lines first, so mentioning them in the rationale stays allowed.
  const ddl = migration
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n')
  assert.doesNotMatch(ddl, /render_sponsor_rotation_state/)
  assert.doesNotMatch(ddl, /render_sponsor_scope_memberships/)
  // The only table this migration alters is master_render_configs.
  const altered = [...ddl.matchAll(/ALTER TABLE\s+ap\.(\w+)/gi)].map(m => m[1])
  assert.deepEqual([...new Set(altered)], ['master_render_configs'])
})
