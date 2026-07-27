// Contract for the two-model selector: TVG and TVG + IMG.
//
// Covers the whole chain in one file — catalog, generator, renderer, frontend
// selector, commercial availability, migration and historical compatibility —
// because every one of those pieces is only correct relative to the others.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  availableVisualModelsForFormat,
  canonicalVisualModel,
  isVisualModel,
  resolveVisualModelSelection,
  selectableVisualModels,
  SPONSOR_POOL_INSUFFICIENT_MESSAGE,
  sponsorCountForVisualModel,
  VISUAL_MODELS,
  visualModelLabel,
} from '../../src/services/visualModels.js'
import {
  MASTER_RUNTIME_STATUS,
  sponsorPoolSizesFrom,
  VISUAL_MODELS_STATE,
  visualModelsStateFor,
} from '../../src/services/masterRuntime.js'
import {
  isLegacyVisualModel,
  masterLookupSlugs,
  normalizeHistoricalVisualModel,
  normalizeVisualModel,
  requireMasterConfiguration,
  resolveLegacyInputPolicy,
  sponsorCountForVisualModel as generatorSponsorCount,
} from '../../supabase/functions/ap-employee-generator/masterConfiguration.ts'
import {
  detectRenderPath,
  prepareRotationV1Render,
} from '../../supabase/functions/ap-render-engine/renderContract.ts'

const root = new URL('../../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')
const SUPABASE_URL = 'https://tenant.supabase.co'

// The four fixed templates. These UUIDs live in ap.master_render_configs only.
const MATRIX = [
  { contentType: 'feed', visualModel: 'tvg', uuid: 'mzszfje7xdh6l', sponsors: 2 },
  { contentType: 'reels', visualModel: 'tvg', uuid: 'xcxtk9tt7syfd', sponsors: 2 },
  { contentType: 'feed', visualModel: 'tvg_img', uuid: '3pm4re4blrizh', sponsors: 1 },
  { contentType: 'reels', visualModel: 'tvg_img', uuid: 'rrbcykdqcrqae', sponsors: 1 },
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
  sha256: sha(name),
})

// `snapshotModel` lets a test freeze a slug that differs from the current
// catalog — that is exactly what a historical candidate looks like.
function candidate({ contentType, visualModel, uuid, sponsors }, snapshotModel) {
  const frozenModel = snapshotModel ?? visualModel
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
      visual_model: frozenModel,
      master_config: { master_template_uuid: uuid, visual_model: frozenModel },
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

const masterConfig = (contentType, visualModel, overrides = {}) => ({
  id: `master-${contentType}-${visualModel}`,
  content_type: contentType,
  visual_model: visualModel,
  // Resolved canonically so a fixture can carry the retired slug and still
  // point at the right fixed template, exactly like a not-yet-migrated row.
  master_template_uuid: MATRIX.find(
    row => row.contentType === contentType &&
      row.visualModel === (canonicalVisualModel(visualModel) ?? visualModel),
  )?.uuid ?? 'uuid',
  enabled: true,
  layer_map: contentType === 'reels' ? REELS_LAYERS : FEED_LAYERS,
  ...overrides,
})

const feedMasters = () => [masterConfig('feed', 'tvg'), masterConfig('feed', 'tvg_img')]
const reelsMasters = () => [masterConfig('reels', 'tvg'), masterConfig('reels', 'tvg_img')]

// ── 1-4. Each pair resolves exactly one fixed template ──────────────────────
for (const row of MATRIX) {
  test(`${row.visualModel} + ${row.contentType} resolve ${row.uuid}`, () => {
    const plan = prepareRotationV1Render(candidate(row), SUPABASE_URL)
    assert.equal(plan.templateId, row.uuid)
  })
}

// ── 5-6. The model derives the sponsor count, front and back ────────────────
test('tvg deriva 2 patrocinadores e tvg_img deriva 1, no frontend e no generator', () => {
  assert.equal(sponsorCountForVisualModel('tvg'), 2)
  assert.equal(sponsorCountForVisualModel('tvg_img'), 1)
  assert.equal(generatorSponsorCount('tvg'), 2)
  assert.equal(generatorSponsorCount('tvg_img'), 1)
})

// ── 7. A new request may never carry the historical slug ────────────────────
test('uma requisicao nova com misto e rejeitada', async () => {
  assert.equal(normalizeVisualModel('misto'), null)
  assert.equal(normalizeVisualModel('MISTO'), null)
  assert.equal(normalizeVisualModel(' Misto '), null)
  assert.ok(isLegacyVisualModel('misto') && isLegacyVisualModel(' MISTO '))
  assert.ok(!isLegacyVisualModel('tvg') && !isLegacyVisualModel('tvg_img'))

  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  // The refusal is explicit and happens before anything is created.
  assert.match(generator, /isLegacyVisualModel\(rawVisualModel\)/)
  assert.match(generator, /MASTER_MODEL_RETIRED/)
  assert.match(
    generator,
    /isLegacyVisualModel\(rawVisualModel\)[\s\S]*?MASTER_MODEL_RETIRED[\s\S]*?if \(!visualModel\)/,
  )
})

test('o generator le um master ainda em misto, mas congela o slug canonico', async () => {
  // Phase 1 of the rollout: the row may not have been renamed yet, so reading
  // it must work — that is what keeps the tenant addressable mid-migration.
  const legacyRow = masterConfig('feed', 'misto')
  const resolved = await requireMasterConfiguration({
    contentType: 'feed',
    visualModel: 'tvg_img',
    readControl: async () => ({ data: null, error: null }),
    readConfig: async () => ({ data: legacyRow, error: null }),
  })
  // UUID and layer map come from the row verbatim.
  assert.equal(resolved.master_template_uuid, '3pm4re4blrizh')
  assert.deepEqual(resolved.layer_map, FEED_LAYERS)

  // ...but the snapshot must freeze the canonical model, never the row's slug.
  // That is the invariant "no new matéria is born as misto".
  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /master_config: \{[\s\S]*?visual_model: visualModel,[\s\S]*?\},\s*\n\s*visual_model: visualModel,/)
  assert.doesNotMatch(generator, /visual_model: config\.visual_model/)

  // A row for a genuinely different model is still refused.
  await assert.rejects(
    () => requireMasterConfiguration({
      contentType: 'feed',
      visualModel: 'tvg_img',
      readControl: async () => ({ data: null, error: null }),
      readConfig: async () => ({ data: masterConfig('feed', 'tvg'), error: null }),
    }),
    error => error.code === 'MASTER_CONFIG_INVALID',
  )
})

test('a politica de entrada legada e explicita e alternavel por ambiente', async () => {
  // Default is transitional: phases 1–3 must not start failing old callers.
  assert.equal(resolveLegacyInputPolicy(undefined), 'accept')
  assert.equal(resolveLegacyInputPolicy(''), 'accept')
  assert.equal(resolveLegacyInputPolicy('accept'), 'accept')
  // Phase 4 hardens it with one environment variable, no code change.
  assert.equal(resolveLegacyInputPolicy('reject'), 'reject')
  assert.equal(resolveLegacyInputPolicy(' REJECT '), 'reject')

  assert.deepEqual(masterLookupSlugs('tvg_img', true), ['tvg_img', 'misto'])
  assert.deepEqual(masterLookupSlugs('tvg_img', false), ['tvg_img'])
  // TVG never had an alias, so it is unaffected in either phase.
  assert.deepEqual(masterLookupSlugs('tvg', true), ['tvg'])

  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /Deno\.env\.get\(LEGACY_INPUT_POLICY_ENV\)/)
  assert.match(generator, /LEGACY_INPUT_POLICY === 'reject' && isLegacyVisualModel\(rawVisualModel\)/)
})

test('normalizacao de leitura historica converte misto sem tocar na de escrita', () => {
  assert.equal(normalizeHistoricalVisualModel('misto'), 'tvg_img')
  assert.equal(normalizeHistoricalVisualModel(' MISTO '), 'tvg_img')
  assert.equal(normalizeHistoricalVisualModel('tvg'), 'tvg')
  assert.equal(normalizeHistoricalVisualModel('itumbiara'), null)
  // The write-path normalizer stays strict regardless of the policy.
  assert.equal(normalizeVisualModel('misto'), null)
})

// ── 8. A historical misto snapshot stays renderable ─────────────────────────
test('snapshot historico misto continua renderizavel e mantem seu UUID congelado', () => {
  const historical = candidate(
    { contentType: 'feed', visualModel: 'tvg_img', uuid: '3pm4re4blrizh', sponsors: 1 },
    'misto',
  )
  assert.equal(detectRenderPath(historical), 'master_rotation_v1')

  const plan = prepareRotationV1Render(historical, SUPABASE_URL)
  assert.equal(plan.templateId, '3pm4re4blrizh')
  assert.match(plan.layers['patrocinador-1'].image, /sponsors\/a\.png$/)
  assert.equal(plan.layers['patrocinador-2'], undefined)
  // The renderer is model-agnostic: nothing normalized or rewrote the slug.
  assert.equal(historical.render_snapshot.visual_model, 'misto')
  assert.equal(historical.render_snapshot.master_config.visual_model, 'misto')
})

test('reels historico misto tambem renderiza a partir do snapshot', () => {
  const historical = candidate(
    { contentType: 'reels', visualModel: 'tvg_img', uuid: 'rrbcykdqcrqae', sponsors: 1 },
    'misto',
  )
  const plan = prepareRotationV1Render(historical, SUPABASE_URL)
  assert.equal(plan.templateId, 'rrbcykdqcrqae')
  assert.equal(plan.layers['news-image'], undefined)
})

// ── 9. A retry never rewrites the frozen visual model ───────────────────────
test('o retry historico reusa a base congelada e nao reescreve visual_model', async () => {
  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /const frozenBase = existingSnapshotBase\(existingCandidate\)/)
  assert.match(generator, /renderSnapshotBase = frozenBase/)
  assert.match(generator, /FROZEN_SNAPSHOT_REUSED/)
  // Nothing in the generator ever writes visual_model back onto a candidate.
  assert.doesNotMatch(generator, /update\(\{[^}]*visual_model/)

  const historical = candidate(
    { contentType: 'feed', visualModel: 'tvg_img', uuid: '3pm4re4blrizh', sponsors: 1 },
    'misto',
  )
  const frozen = JSON.parse(JSON.stringify(historical.render_snapshot))
  prepareRotationV1Render(historical, SUPABASE_URL)
  prepareRotationV1Render(historical, SUPABASE_URL)
  // Deterministic: rendering twice mutates nothing.
  assert.deepEqual(historical.render_snapshot, frozen)
})

// ── 10-12. The catalog the operator sees ────────────────────────────────────
test('o catalogo expoe exatamente TVG e TVG + IMG, e nunca Misto', () => {
  assert.deepEqual(VISUAL_MODELS.map(model => model.slug), ['tvg', 'tvg_img'])
  assert.deepEqual(VISUAL_MODELS.map(model => model.label), ['TVG', 'TVG + IMG'])
  assert.equal(visualModelLabel('tvg'), 'TVG')
  assert.equal(visualModelLabel('tvg_img'), 'TVG + IMG')
  // A historical row reads as TVG + IMG: no screen can render the word "Misto".
  assert.equal(visualModelLabel('misto'), 'TVG + IMG')
  assert.ok(!VISUAL_MODELS.some(model => /misto/i.test(model.label)))
  assert.ok(!VISUAL_MODELS.some(model => /misto/i.test(model.slug)))
  // Strict for new selections, tolerant only when reading history.
  assert.ok(isVisualModel('tvg') && isVisualModel('tvg_img'))
  assert.ok(!isVisualModel('misto'))
  assert.equal(canonicalVisualModel('misto'), 'tvg_img')
  assert.equal(canonicalVisualModel('itumbiara'), null)
})

test('nenhuma tela do produto escreve a palavra Misto', async () => {
  const rendered = async file => (await source(file))
    .split('\n')
    .filter(line => !line.trimStart().startsWith('//'))
    .join('\n')

  for (const file of [
    'src/services/masterRuntime.js',
    'src/components/editorial/ArticleForm.jsx',
    'src/pages/admin/AutoPublisher.jsx',
    'src/pages/admin/EmployeeMode.jsx',
  ]) {
    assert.doesNotMatch(await rendered(file), /misto/i, `${file} still mentions Misto`)
  }

  // The catalog is the single place allowed to name the historical slug, and
  // only as the read-only alias key — never as a label.
  const catalog = await rendered('src/services/visualModels.js')
  assert.deepEqual(
    [...catalog.matchAll(/misto/gi)].map(match => match[0]),
    ['misto'],
  )
  assert.match(catalog, /LEGACY_VISUAL_MODEL_ALIASES = Object\.freeze\(\{ misto: 'tvg_img' \}\)/)
})

// ── 13-14. Format switching and enablement ──────────────────────────────────
test('alternar Feed/Reels troca as opcoes oferecidas', () => {
  const configs = [...feedMasters(), masterConfig('reels', 'tvg')]
  assert.deepEqual(
    availableVisualModelsForFormat(configs, {}, 'feed').map(m => m.slug),
    ['tvg', 'tvg_img'],
  )
  assert.deepEqual(
    availableVisualModelsForFormat(configs, {}, 'reels').map(m => m.slug),
    ['tvg'],
  )
})

test('somente modelos habilitados e completos aparecem', () => {
  const disabled = availableVisualModelsForFormat(
    [masterConfig('feed', 'tvg'), masterConfig('feed', 'tvg_img', { enabled: false })],
    {},
    'feed',
  )
  assert.deepEqual(disabled.map(m => m.slug), ['tvg'])

  const incomplete = availableVisualModelsForFormat(
    [masterConfig('feed', 'tvg'), masterConfig('feed', 'tvg_img', { master_template_uuid: '' })],
    {},
    'feed',
  )
  assert.deepEqual(incomplete.map(m => m.slug), ['tvg'])

  assert.deepEqual(availableVisualModelsForFormat(feedMasters(), { kill_switch: true }, 'feed'), [])
})

test('um master historico ainda em misto continua endereçavel como TVG + IMG', () => {
  // Deploy safety: the selector keeps working if the function ships before the
  // rename migration. The label and the slug offered are always the new ones.
  const models = availableVisualModelsForFormat(
    [masterConfig('feed', 'tvg'), masterConfig('feed', 'misto')],
    {},
    'feed',
  )
  assert.deepEqual(models.map(m => m.slug), ['tvg', 'tvg_img'])
  assert.deepEqual(models.map(m => m.label), ['TVG', 'TVG + IMG'])
})

// ── The selector state machine ──────────────────────────────────────────────
test('uma unica opcao e escolhida automaticamente; duas exigem escolha', () => {
  const both = availableVisualModelsForFormat(feedMasters(), {}, 'feed')
  assert.equal(resolveVisualModelSelection('', both), '')

  const only = availableVisualModelsForFormat([masterConfig('reels', 'tvg')], {}, 'reels')
  assert.equal(resolveVisualModelSelection('', only), 'tvg')
})

test('trocar de formato preserva a escolha valida e limpa a invalida', () => {
  const reelsOnlyTvg = availableVisualModelsForFormat([masterConfig('reels', 'tvg')], {}, 'reels')
  // tvg_img has no reels master: the stale choice is dropped and, with a single
  // remaining option, replaced automatically.
  assert.equal(resolveVisualModelSelection('tvg_img', reelsOnlyTvg), 'tvg')

  const both = availableVisualModelsForFormat(reelsMasters(), {}, 'reels')
  assert.equal(resolveVisualModelSelection('tvg_img', both), 'tvg_img')
  assert.equal(resolveVisualModelSelection('misto', both), '')
})

// ── 15. Generation is blocked without a usable option ───────────────────────
test('sem nenhum modelo disponivel a geracao e bloqueada', async () => {
  assert.equal(
    visualModelsStateFor(MASTER_RUNTIME_STATUS.READY, []),
    VISUAL_MODELS_STATE.EMPTY,
  )
  assert.equal(resolveVisualModelSelection('', []), '')

  const form = await source('src/components/editorial/ArticleForm.jsx')
  assert.match(form, /selectableModels\.length === 0/)
  assert.match(form, /disabled=\{isSubmitting \|\| generationBlocked\}/)
})

// ── 16-17. sponsor_count and UUID stay server-derived ───────────────────────
test('sponsor_count manual e UUID manual continuam rejeitados', async () => {
  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /SPONSOR_COUNT_NOT_ALLOWED/)
  assert.match(generator, /MANUAL_TEMPLATE_NOT_ALLOWED/)
  assert.match(generator, /const sponsorCount = sponsorCountForVisualModel\(/)
  assert.match(generator, /p_sponsor_count: sponsorCount/)
  assert.match(generator, /master_template_uuid: config\.master_template_uuid/)
})

test('o frontend envia apenas visual_model, nunca detalhes tecnicos', async () => {
  for (const file of ['src/pages/admin/AutoPublisher.jsx', 'src/pages/admin/EmployeeMode.jsx']) {
    const page = await source(file)
    assert.match(page, /payload\.visual_model = /)
    assert.doesNotMatch(page, /payload\.sponsor_count/)
    assert.doesNotMatch(page, /payload\.placid_template_uuid/)
    assert.doesNotMatch(page, /payload\.template_set/)
    assert.doesNotMatch(page, /payload\.layer_map/)
    assert.doesNotMatch(page, /payload\.patrocinador/)
  }
})

// ── 18-20. Sponsor pool rules ───────────────────────────────────────────────
test('TVG exige dois patrocinadores e TVG + IMG exige um', () => {
  const one = availableVisualModelsForFormat(feedMasters(), {}, 'feed', 1)
  assert.deepEqual(one.map(m => m.slug), ['tvg', 'tvg_img'])
  assert.deepEqual(one.map(m => m.selectable), [false, true])
  assert.equal(one[0].unavailableReason, SPONSOR_POOL_INSUFFICIENT_MESSAGE)
  assert.equal(one[0].unavailableReason, 'Indisponível: patrocinadores insuficientes.')
  assert.deepEqual(selectableVisualModels(one).map(m => m.slug), ['tvg_img'])

  const none = availableVisualModelsForFormat(feedMasters(), {}, 'feed', 0)
  assert.deepEqual(none.map(m => m.selectable), [false, false])
  assert.deepEqual(selectableVisualModels(none), [])

  const two = availableVisualModelsForFormat(feedMasters(), {}, 'feed', 2)
  assert.deepEqual(two.map(m => m.selectable), [true, true])
})

test('com o pool desconhecido tudo continua selecionavel e o backend falha fechado', async () => {
  const unknown = availableVisualModelsForFormat(feedMasters(), {}, 'feed', null)
  assert.deepEqual(unknown.map(m => m.selectable), [true, true])

  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /SPONSOR_POOL_INSUFFICIENT/)
  assert.match(generator, /Patrocinadores ativos insuficientes para este modelo visual\./)
})

test('o pool elegivel conta apenas patrocinador ativo com vinculo ativo no formato', () => {
  const sponsors = [
    { id: 's1', ativo: true },
    { id: 's2', ativo: true },
    { id: 's3', ativo: false },
  ]
  const memberships = [
    { sponsor_id: 's1', content_type: 'feed', ativo: true },
    { sponsor_id: 's2', content_type: 'feed', ativo: true },
    { sponsor_id: 's3', content_type: 'feed', ativo: true },
    { sponsor_id: 's1', content_type: 'reels', ativo: true },
    { sponsor_id: 's2', content_type: 'reels', ativo: false },
  ]
  assert.deepEqual(sponsorPoolSizesFrom(sponsors, memberships), { feed: 2, reels: 1 })
})

test('TVG usa dois patrocinadores distintos e nunca repete um slot', () => {
  for (const row of MATRIX.filter(r => r.visualModel === 'tvg')) {
    const plan = prepareRotationV1Render(candidate(row), SUPABASE_URL)
    assert.match(plan.layers['patrocinador-1'].image, /sponsors\/a\.png$/)
    assert.match(plan.layers['patrocinador-2'].image, /sponsors\/b\.png$/)
    assert.notEqual(
      plan.layers['patrocinador-1'].image,
      plan.layers['patrocinador-2'].image,
    )
  }

  // The same sponsor in both slots is refused by the renderer contract.
  const duplicated = candidate(MATRIX[0])
  duplicated.render_snapshot.sponsor_selection.items[1] = {
    ...sponsorAsset('sponsor_2', 'a'),
    sponsor_id: 'sponsor-a',
  }
  assert.throws(
    () => prepareRotationV1Render(duplicated, SUPABASE_URL),
    error => error.code === 'SPONSOR_DUPLICATE',
  )
})

test('TVG falha fechado com menos de dois patrocinadores', () => {
  const starved = candidate(MATRIX[0])
  starved.render_snapshot.sponsor_selection.items =
    starved.render_snapshot.sponsor_selection.items.slice(0, 1)
  assert.throws(
    () => prepareRotationV1Render(starved, SUPABASE_URL),
    error => error.code === 'SPONSOR_COUNT_MISMATCH',
  )
})

// ── 21-23. Layer composition per model and format ───────────────────────────
test('TVG + IMG usa apenas patrocinador-1 e omite patrocinador-2', () => {
  for (const row of MATRIX.filter(r => r.visualModel === 'tvg_img')) {
    const plan = prepareRotationV1Render(candidate(row), SUPABASE_URL)
    assert.match(plan.layers['patrocinador-1'].image, /sponsors\/a\.png$/)
    assert.ok(!Object.keys(plan.layers).includes('patrocinador-2'))
  }
})

test('Feed envia news-image e Reels nao envia', () => {
  for (const row of MATRIX) {
    const plan = prepareRotationV1Render(candidate(row), SUPABASE_URL)
    if (row.contentType === 'feed') {
      assert.equal(plan.layers['news-image'].image, 'https://cdn.test/news.jpg')
    } else {
      assert.ok(!Object.keys(plan.layers).includes('news-image'))
    }
  }
})

test('titulo-materia recebe texto e titulo-png recebe imagem', () => {
  for (const row of MATRIX) {
    const plan = prepareRotationV1Render(candidate(row), SUPABASE_URL)
    assert.deepEqual(plan.layers['titulo-materia'], { text: 'Novo viaduto é inaugurado' })
    assert.match(plan.layers['titulo-png'].image, /visual-titles\/noticias\.png$/)
    assert.equal(plan.layers['titulo-png'].text, undefined)
  }
})

test('o UUID vem sempre do snapshot, nunca do frontend', () => {
  const forged = candidate(MATRIX[0])
  forged.placid_template_uuid = 'uuid-forjado-pelo-cliente'
  const plan = prepareRotationV1Render(forged, SUPABASE_URL)
  assert.equal(plan.templateId, MATRIX[0].uuid)
})

// ── 24. Telemetry ───────────────────────────────────────────────────────────
test('correlation_id e a telemetria p0.2 continuam funcionando', async () => {
  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /resolveCorrelationId/)
  assert.match(generator, /correlation_id: context\.correlationId/)
  assert.match(generator, /functionVersion: AP_EMPLOYEE_GENERATOR_VERSION/)

  const config = await source(
    'supabase/functions/ap-employee-generator/masterConfiguration.ts',
  )
  assert.match(config, /AP_EMPLOYEE_GENERATOR_VERSION = '2026-07-26-p0\.2'/)

  const telemetry = await source(
    'supabase/functions/ap-employee-generator/unexpectedErrorTelemetry.ts',
  )
  // The allow-list keeps 'misto' so a rejected legacy request stays observable.
  assert.match(telemetry, /safeEnum\(input\.visualModel, \['tvg', 'tvg_img', 'misto'\]\)/)
})

// ── 25. No new legacy candidate ─────────────────────────────────────────────
test('nenhuma materia nova nasce legacy nem consulta o catalogo legado', async () => {
  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /p_render_contract_version: 'master_v1'/)
  assert.doesNotMatch(generator, /\.from\(['"]templates['"]\)/)
  assert.doesNotMatch(generator, /\.from\(['"]template_render_profiles['"]\)/)
  assert.doesNotMatch(generator, /get_and_advance_template/)
  assert.match(generator, /IDEMPOTENCY_CONTRACT_MISMATCH/)
})

// ── 26-28. The migration ────────────────────────────────────────────────────
const MIGRATION =
  'supabase/migrations/20260727120000_rename_visual_model_misto_to_tvg_img.sql'

const migrationDdl = async () => {
  const contents = await source(MIGRATION)
  return contents
    .split('\n')
    .filter(line => !line.trimStart().startsWith('--'))
    .join('\n')
}

test('a migration renomeia apenas o slug: enabled, UUID e layer_map intocados', async () => {
  const ddl = await migrationDdl()
  assert.match(
    ddl,
    /UPDATE ap\.master_render_configs\s+SET visual_model = 'tvg_img'\s+WHERE visual_model = 'misto';/,
  )
  // The only column any UPDATE writes is visual_model.
  const assignments = [...ddl.matchAll(/SET\s+(\w+)\s*=/g)].map(match => match[1])
  assert.deepEqual([...new Set(assignments)], ['visual_model'])
  assert.doesNotMatch(ddl, /SET[\s\S]{0,80}enabled\s*=/)
  assert.doesNotMatch(ddl, /master_template_uuid\s*=/)
  assert.doesNotMatch(ddl, /layer_map\s*=/)
})

test('a migration nao toca candidate_news nem as tabelas de rotacao', async () => {
  const ddl = await migrationDdl()
  assert.doesNotMatch(ddl, /candidate_news/)
  assert.doesNotMatch(ddl, /render_sponsor_rotation_state/)
  assert.doesNotMatch(ddl, /render_sponsor_scope_memberships/)
  assert.doesNotMatch(ddl, /render_sponsors\b/)
  const altered = [...ddl.matchAll(/ALTER TABLE\s+ap\.(\w+)/gi)].map(m => m[1])
  assert.deepEqual([...new Set(altered)], ['master_render_configs'])
})

test('a migration atualiza o CHECK e mantem a unicidade dos quatro masters', async () => {
  const ddl = await migrationDdl()
  assert.match(ddl, /CHECK \(visual_model IN \('tvg', 'tvg_img'\)\)/)
  assert.doesNotMatch(ddl, /CHECK \([^)]*'misto'/)
  assert.match(
    ddl,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_master_render_config_per_visual_model\s+ON ap\.master_render_configs \(cliente_id, content_type, visual_model\)/,
  )
})

test('a migration e defensiva contra reexecucao e contra colisao', async () => {
  const ddl = await migrationDdl()
  assert.match(ddl, /DROP CONSTRAINT IF EXISTS master_render_configs_visual_model_check/)
  assert.match(ddl, /CREATE UNIQUE INDEX IF NOT EXISTS/)
  assert.match(ddl, /CREATE INDEX IF NOT EXISTS/)
  assert.match(ddl, /to_regclass\('ap\.master_render_configs'\) IS NULL/)
  assert.match(ddl, /MASTER_RENDER_CONFIG_VISUAL_MODEL_RENAME_COLLISION/)
  assert.match(ddl, /MASTER_RENDER_CONFIG_VISUAL_MODEL_UNKNOWN/)
  // Enabling is never automatic.
  assert.doesNotMatch(ddl, /enabled\s*=\s*true/i)
})

test('a matriz de UUIDs congelada nao muda em lugar nenhum', async () => {
  const seed = await source('supabase/seeds/master_render_visual_models.sql')
  for (const row of MATRIX) {
    assert.ok(seed.includes(row.uuid), `seed lost ${row.uuid}`)
  }
  assert.match(seed, /'feed',\s+'tvg',\s+'mzszfje7xdh6l'/)
  assert.match(seed, /'feed',\s+'tvg_img',\s+'3pm4re4blrizh'/)
  assert.match(seed, /'reels',\s+'tvg',\s+'xcxtk9tt7syfd'/)
  assert.match(seed, /'reels',\s+'tvg_img',\s+'rrbcykdqcrqae'/)
  // Re-seeding never re-enables a deliberately disabled master.
  assert.match(seed, /enabled = ap\.master_render_configs\.enabled/)

  const ddl = await migrationDdl()
  for (const row of MATRIX) {
    assert.ok(!ddl.includes(row.uuid), `migration must not restate ${row.uuid}`)
  }
})
