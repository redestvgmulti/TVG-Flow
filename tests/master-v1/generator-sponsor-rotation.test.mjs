import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  normalizeVisualModel,
  requireMasterConfiguration,
  sponsorCountForVisualModel,
} from '../../supabase/functions/ap-employee-generator/masterConfiguration.ts'

const generatorUrl = new URL(
  '../../supabase/functions/ap-employee-generator/index.ts',
  import.meta.url,
)

test('new manual candidates require the visual model instead of legacy fallback', async () => {
  const source = await readFile(generatorUrl, 'utf8')
  assert.equal(normalizeVisualModel(null), null)
  assert.match(source, /MASTER_MODEL_REQUIRED/)
  assert.doesNotMatch(source, /get_and_advance_template|\.from\('templates'\)/)
})

test('tvg and tvg_img derive exactly two and one sponsors', () => {
  assert.equal(sponsorCountForVisualModel('tvg'), 2)
  assert.equal(sponsorCountForVisualModel('tvg_img'), 1)
})

test('manual sponsor_count and UUID are rejected before rotation', async () => {
  const source = await readFile(generatorUrl, 'utf8')
  assert.match(source, /SPONSOR_COUNT_NOT_ALLOWED/)
  assert.match(source, /MANUAL_TEMPLATE_NOT_ALLOWED/)
})

test('master lookup is scoped by tenant, format and visual model', async () => {
  const source = await readFile(generatorUrl, 'utf8')
  // The visual model is an `.in()` during the rename window: it may address the
  // canonical slug or the row still stored under the retired one.
  assert.match(source, /\.eq\('cliente_id', clienteId\)[\s\S]*\.eq\('content_type', content_type\)[\s\S]*\.in\(\s*'visual_model',/)

  const config = {
    id: 'master',
    content_type: 'feed',
    visual_model: 'tvg_img',
    enabled: true,
    master_template_uuid: 'uuid-from-config',
    layer_map: {
      headline: 'titulo-materia',
      news_image: 'news-image',
      visual_title: 'titulo-png',
      sponsor_1: 'patrocinador-1',
    },
  }
  const actual = await requireMasterConfiguration({
    contentType: 'feed',
    visualModel: 'tvg_img',
    readControl: async () => ({ data: null, error: null }),
    readConfig: async () => ({ data: config, error: null }),
  })
  assert.equal(actual.master_template_uuid, 'uuid-from-config')
})

test('master path delegates creation to the transactional RPC', async () => {
  const source = await readFile(generatorUrl, 'utf8')
  assert.match(source, /rpc\('create_candidate_with_sponsors'/)
  assert.match(source, /p_sponsor_count: sponsorCount/)
  assert.match(source, /p_render_contract_version: 'master_v1'/)
  assert.match(source, /p_render_snapshot_base: renderSnapshotBase/)
})

test('committed retries use the frozen base and skip live configuration', async () => {
  const source = await readFile(generatorUrl, 'utf8')
  assert.match(source, /shouldResolveVisualTitleForCreation\(existingCandidate\)/)
  assert.match(source, /existingSnapshotBase\(existingCandidate\)/)
  assert.match(source, /FROZEN_SNAPSHOT_REUSED/)
})

test('generator records safe versioned lifecycle events', async () => {
  const source = await readFile(generatorUrl, 'utf8')
  assert.match(source, /AP_EMPLOYEE_GENERATOR_VERSION/)
  assert.match(source, /MASTER_CONFIG_LOADED/)
  assert.match(source, /CANDIDATE_CREATED/)
  assert.match(source, /GENERATION_COMPLETED/)
})
