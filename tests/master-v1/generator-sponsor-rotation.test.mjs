import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  normalizeVisualModel,
  requireMasterConfiguration,
  sponsorCountFromConfig,
} from '../../supabase/functions/ap-employee-generator/masterConfiguration.ts'

const generatorUrl = new URL(
  '../../supabase/functions/ap-employee-generator/index.ts',
  import.meta.url,
)

test('new manual candidates require the visual model instead of legacy fallback', async () => {
  const source = await readFile(generatorUrl, 'utf8')
  assert.equal(normalizeVisualModel(null), null)
  assert.match(source, /VISUAL_MODEL_REQUIRED/)
  assert.doesNotMatch(source, /get_and_advance_template|\.from\('templates'\)/)
})

test('sponsor count is derived from the resolved master config', () => {
  assert.equal(sponsorCountFromConfig({ sponsor_count: 2 }), 2)
  assert.equal(sponsorCountFromConfig({ sponsor_count: 1 }), 1)
})

test('manual sponsor_count and UUID are rejected before rotation', async () => {
  const source = await readFile(generatorUrl, 'utf8')
  assert.match(source, /SPONSOR_COUNT_NOT_ALLOWED/)
  assert.match(source, /MANUAL_TEMPLATE_NOT_ALLOWED/)
})

test('master lookup is scoped by tenant, format and visual model', async () => {
  const source = await readFile(generatorUrl, 'utf8')
  assert.match(source, /\.eq\(["']cliente_id["'], clienteId\)[\s\S]*\.eq\(["']content_type["'], content_type\)[\s\S]*\.eq\(["']visual_model["'], visualModel\)/)

  const config = {
    id: 'master',
    content_type: 'feed',
    visual_model: 'tvg_img',
    enabled: true,
    master_template_uuid: 'uuid-from-config',
    sponsor_count: 1,
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
  assert.match(source, /rpc\(["']create_candidate_with_sponsors["']/)
  assert.match(source, /p_sponsor_count: sponsorCount/)
  assert.match(source, /p_render_contract_version: ["']master_v1["']/)
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
