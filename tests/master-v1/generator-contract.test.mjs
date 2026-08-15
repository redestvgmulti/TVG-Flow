import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildLegacyLayers,
  detectRenderPath,
} from '../../supabase/functions/ap-render-engine/renderContract.ts'

const generatorUrl = new URL(
  '../../supabase/functions/ap-employee-generator/index.ts',
  import.meta.url,
)

test('manual generator creates only master_v1 candidates', async () => {
  const source = await readFile(generatorUrl, 'utf8')
  assert.match(source, /p_render_contract_version: ["']master_v1["']/)
  assert.match(source, /VISUAL_MODEL_REQUIRED/)
  assert.doesNotMatch(source, /render_contract_version:\s*['"]legacy['"]/)
  assert.doesNotMatch(source, /get_and_advance_template|rotateTemplate/)
})

test('manual generator never reads legacy template profiles', async () => {
  const source = await readFile(generatorUrl, 'utf8')
  assert.doesNotMatch(source, /\.from\(['"]template_render_profiles['"]\)/)
  assert.doesNotMatch(source, /\.from\(['"]templates['"]\)/)
})

test('legacy snapshot remains selected by the renderer', () => {
  const item = {
    render_contract_version: 'legacy',
    render_snapshot: {
      render_contract_version: 'legacy',
      legacy_placid_template_uuid: 'legacy-template',
    },
  }
  assert.equal(detectRenderPath(item), 'legacy')
})

test('legacy layers remain backward compatible for old candidate_news rows', () => {
  const layers = buildLegacyLayers({
    content_type: 'feed',
    headline: 'Titulo antigo',
    context_tag: 'LEGACY',
    imagem_url: 'https://example.test/legacy.jpg',
  }, 'https://example.test')
  assert.deepEqual(layers, {
    headline_news: { text: 'Titulo antigo' },
    tag_news: { text: 'LEGACY' },
    'news-image': { image: 'https://example.test/legacy.jpg' },
  })
})

test('generator documents renderer-owned historical retry compatibility', async () => {
  const source = await readFile(generatorUrl, 'utf8')
  assert.match(source, /Historical legacy retries[\s\S]*ap-render-engine[\s\S]*immutable candidate snapshot/)
})
