import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  AP_EMPLOYEE_GENERATOR_VERSION,
  buildGeneratorLogEvent,
  MasterConfigurationError,
  normalizeVisualModel,
  requireMasterConfiguration,
  sponsorCountFromConfig,
} from '../../supabase/functions/ap-employee-generator/masterConfiguration.ts'
import {
  MASTER_RUNTIME_STATUS,
  VISUAL_MODELS_STATE,
  visualModelsBlockMessage,
  visualModelsStateFor,
} from '../../src/services/masterRuntime.js'
import { availableVisualModelsForFormat } from '../../src/services/visualModels.js'
import {
  buildLegacyLayers,
  detectRenderPath,
} from '../../supabase/functions/ap-render-engine/renderContract.ts'

const root = new URL('../../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')

test('generator release marker is unique to the visual catalog expansion', async () => {
  assert.equal(AP_EMPLOYEE_GENERATOR_VERSION, '2026-08-15-employee-material-delivery.1')

  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /correlation_id: context\.correlationId/)
  assert.match(generator, /functionVersion: AP_EMPLOYEE_GENERATOR_VERSION/)
  assert.match(generator, /function_version: AP_EMPLOYEE_GENERATOR_VERSION/)
})

const baseConfig = {
  id: 'master-feed-tvg-img',
  content_type: 'feed',
  visual_model: 'tvg_img',
  enabled: true,
  master_template_uuid: 'master-feed-tvg-img-uuid',
  sponsor_count: 1,
  layer_map: {
    headline: 'titulo-materia',
    news_image: 'news-image',
    visual_title: 'titulo-png',
    sponsor_1: 'patrocinador-1',
  },
}

const reads = ({ control = null, config = baseConfig, controlError = null, configError = null } = {}) => ({
  contentType: 'feed',
  visualModel: 'tvg_img',
  readControl: async () => ({ data: control, error: controlError }),
  readConfig: async () => ({ data: config, error: configError }),
})

test('manual visual_model is required and accepts the controlled catalog', async () => {
  assert.equal(normalizeVisualModel(null), null)
  assert.equal(normalizeVisualModel(''), null)
  assert.equal(normalizeVisualModel('outro'), null)
  assert.equal(normalizeVisualModel(' TVG '), 'tvg')
  assert.equal(normalizeVisualModel('Misto'), null)
  assert.equal(normalizeVisualModel('TVG_IMG'), 'tvg_img')
  assert.equal(normalizeVisualModel('Individual'), 'individual')
  assert.equal(normalizeVisualModel('Aparecida'), 'aparecida')
  assert.equal(normalizeVisualModel('Story'), 'story')

  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /VISUAL_MODEL_REQUIRED/)
  assert.match(generator, /VISUAL_MODEL_INVALID/)
})

test('master disabled, missing, invalid, permission denied or query failure block', async () => {
  const cases = [
    [reads({ config: { ...baseConfig, enabled: false } }), 'VISUAL_MODEL_NOT_AVAILABLE'],
    [reads({ config: null }), 'VISUAL_MODEL_NOT_AVAILABLE'],
    [reads({ config: { ...baseConfig, master_template_uuid: null } }), 'MASTER_CONFIG_INVALID'],
    [reads({ configError: { code: '42501', message: 'permission denied' } }), 'MASTER_CONFIG_READ_FAILED'],
    [{ ...reads(), readControl: async () => { throw new Error('network') } }, 'MASTER_CONFIG_READ_FAILED'],
  ]

  for (const [input, code] of cases) {
    await assert.rejects(
      () => requireMasterConfiguration(input),
      error => error instanceof MasterConfigurationError && error.code === code,
    )
  }
})

test('disabled visual model fails closed before source image validation', async () => {
  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  const masterResolution = generator.indexOf('config = await requireMasterConfiguration')
  const sourceImageValidation = generator.indexOf('if (sourceImageSupported && !imageUrl)')

  assert.ok(masterResolution >= 0, 'generator must resolve the live master configuration')
  assert.ok(
    sourceImageValidation > masterResolution,
    'disabled masters must fail closed before SOURCE_IMAGE_REQUIRED is evaluated',
  )
  assert.match(generator, /["']SOURCE_IMAGE_REQUIRED["']/)
})

test('visual model derives sponsor count and UUID/layers come from master config', async () => {
  assert.equal(sponsorCountFromConfig({ sponsor_count: 2 }), 2)
  assert.equal(sponsorCountFromConfig({ sponsor_count: 1 }), 1)

  const resolved = await requireMasterConfiguration(reads())
  assert.equal(resolved.master_template_uuid, baseConfig.master_template_uuid)
  assert.deepEqual(resolved.layer_map, baseConfig.layer_map)

  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /p_sponsor_count: sponsorCount/)
  assert.match(generator, /master_template_uuid: config\.master_template_uuid/)
  assert.match(generator, /layer_map: config\.layer_map/)
  assert.match(generator, /SPONSOR_COUNT_NOT_ALLOWED/)
})

test('new manual path never consults legacy template/profile tables', async () => {
  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.doesNotMatch(generator, /\.from\(['"]templates['"]\)/)
  assert.doesNotMatch(generator, /\.from\(['"]template_render_profiles['"]\)/)
  assert.doesNotMatch(generator, /get_and_advance_template/)
  assert.match(generator, /rpc\(["']create_candidate_with_sponsors["']/)
  assert.match(generator, /p_render_contract_version: ["']master_v1["']/)
})

test('committed master retry reuses frozen request base without live config lookup', async () => {
  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /existingSnapshotBase\(existingCandidate\)/)
  assert.match(generator, /FROZEN_SNAPSHOT_REUSED/)
  assert.match(generator, /if \(shouldResolveVisualTitleForCreation\(existingCandidate\)\)/)
  assert.match(generator, /p_render_snapshot_base: renderSnapshotBase/)
})

test('legacy candidate snapshots remain renderable by the historical renderer path', () => {
  const legacy = {
    content_type: 'feed',
    render_contract_version: 'legacy',
    render_snapshot: { render_contract_version: 'legacy' },
    headline: 'Headline antiga',
    context_tag: 'LEGACY',
    imagem_url: 'https://example.test/news.jpg',
  }
  assert.equal(detectRenderPath(legacy), 'legacy')
  assert.deepEqual(buildLegacyLayers(legacy, 'https://example.test'), {
    headline_news: { text: 'Headline antiga' },
    tag_news: { text: 'LEGACY' },
    'news-image': { image: 'https://example.test/news.jpg' },
  })
})

test('frontend distinguishes loading, empty, error and available', () => {
  assert.equal(visualModelsStateFor(MASTER_RUNTIME_STATUS.LOADING, []), VISUAL_MODELS_STATE.LOADING)
  assert.equal(visualModelsStateFor(MASTER_RUNTIME_STATUS.READY, []), VISUAL_MODELS_STATE.EMPTY)
  assert.equal(visualModelsStateFor(MASTER_RUNTIME_STATUS.ERROR, []), VISUAL_MODELS_STATE.ERROR)
  assert.equal(visualModelsStateFor(MASTER_RUNTIME_STATUS.READY, [{ slug: 'tvg_img' }]), VISUAL_MODELS_STATE.AVAILABLE)
  assert.equal(visualModelsBlockMessage(VISUAL_MODELS_STATE.EMPTY), 'Nenhum modelo visual está habilitado para este formato.')
  assert.equal(visualModelsBlockMessage(VISUAL_MODELS_STATE.ERROR), 'Não foi possível carregar os modelos visuais. Tente novamente.')
})

test('frontend blocks both empty and error, retries loading, and shows enabled model', async () => {
  const form = await source('src/components/editorial/ArticleForm.jsx')
  assert.match(form, /const submissionDisabled = Boolean\(isSubmitting \|\| generationBlocked\)/)
  assert.match(form, /disabled=\{submissionDisabled\}/)
  assert.match(form, /visualModelsState === 'error'/)
  assert.match(form, /visualModelsState === 'empty'/)
  assert.match(form, /onRetryVisualModels/)
  assert.match(form, /Recarregar configuração/)

  const models = availableVisualModelsForFormat([baseConfig], { kill_switch: false }, 'feed')
  assert.deepEqual(models.map(model => model.slug), ['tvg_img'])
})

test('logs include safe code and version without accepting secrets or signed URLs', async () => {
  const event = buildGeneratorLogEvent({
    articleId: '11111111-1111-4111-8111-111111111111',
    clientId: '22222222-2222-4222-8222-222222222222',
    contentType: 'feed',
    visualModel: 'misto',
    stage: 'master_render_configs',
    code: 'MASTER_CONFIG_READ_FAILED',
  })
  assert.equal(event.function_version, AP_EMPLOYEE_GENERATOR_VERSION)
  assert.equal(event.code, 'MASTER_CONFIG_READ_FAILED')

  const hostile = JSON.stringify(buildGeneratorLogEvent({
    articleId: 'Bearer secret-token',
    clientId: 'https://signed.example.test?token=secret',
    stage: 'stage',
    code: 'CODE',
  }))
  assert.doesNotMatch(hostile, /secret-token|signed\.example|token=secret/)

  const generator = await source('supabase/functions/ap-employee-generator/index.ts')
  assert.match(generator, /AP_EMPLOYEE_GENERATOR_VERSION/)
  assert.match(generator, /buildGeneratorLogEvent/)
  assert.doesNotMatch(generator, /console\.(?:log|error)\([^\n]*(?:req|body|authorization|SUPABASE_SERVICE_ROLE_KEY)/i)
})

test('migration grants only SELECT and SQL contract certifies minimal grants and RLS', async () => {
  const migration = await source('supabase/migrations/20260726165558_grant_master_config_select_to_service_role.sql')
  assert.match(migration, /GRANT SELECT ON TABLE[\s\S]*master_render_controls[\s\S]*master_render_configs[\s\S]*template_render_profiles[\s\S]*TO service_role;/)
  assert.doesNotMatch(migration, /GRANT[^;]*(?:INSERT|UPDATE|DELETE|OWNERSHIP)/i)

  const sql = await source('tests/master-v1/master-config-service-role-grants.sql')
  assert.match(sql, /has_table_privilege\('service_role',[\s\S]*'SELECT'\)/)
  assert.match(sql, /NOT has_table_privilege\('service_role',[\s\S]*'INSERT'\)/)
  assert.match(sql, /SET LOCAL ROLE anon/)
  assert.match(sql, /SET LOCAL ROLE authenticated/)
  assert.match(sql, /relrowsecurity/)
  assert.match(sql, /tenant isolation changed/)
})
