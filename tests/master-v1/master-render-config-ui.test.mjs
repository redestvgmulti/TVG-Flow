import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
async function source(path) { return readFile(new URL(path, root), 'utf8') }

test('the render config screen writes master_render_configs and master_render_controls, tenant-scoped', async () => {
  const src = await source('src/components/editorial/MasterRenderConfig.jsx')
  assert.match(src, /from\('master_render_configs'\)[\s\S]*\.upsert\(/)
  assert.match(src, /from\('master_render_controls'\)[\s\S]*\.upsert\(/)
  // Upsert keyed on the (cliente_id, content_type) identity, and always carries cliente_id.
  assert.match(src, /onConflict:\s*'cliente_id,content_type'/)
  assert.match(src, /cliente_id:\s*clienteId/)
})

test('the render config builds a guided layer_map with the exact renderer keys, no free JSON', async () => {
  const src = await source('src/components/editorial/MasterRenderConfig.jsx')
  for (const key of ['headline', 'tag', 'news_image', 'visual_title', 'sponsor_1', 'sponsor_2']) {
    assert.match(src, new RegExp(`'${key}'`), `layer key ${key} must be present`)
  }
  // No raw JSON editor for the layer map.
  assert.doesNotMatch(src, /JSON\.parse\(/)
})

test('the render config never exposes template_set to the operator', async () => {
  const src = await source('src/components/editorial/MasterRenderConfig.jsx')
  // template_set is preserved internally but never rendered as an input/label.
  assert.doesNotMatch(src, /Template set|template set|Conjunto de templates|Grupo de templates/i)
  // It is preserved on save, not asked from the user.
  assert.match(src, /template_set:\s*existing\s*\?\s*existing\.template_set/)
})

test('the render config blocks enabling an incomplete config', async () => {
  const src = await source('src/components/editorial/MasterRenderConfig.jsx')
  assert.match(src, /masterV1ConfigIssues\(/)
  // On issues while enabling, it returns without persisting enabled=true.
  assert.match(src, /if \(issues\.length\)[\s\S]*return/)
})

test('the render config confirms before activating the kill switch', async () => {
  const src = await source('src/components/editorial/MasterRenderConfig.jsx')
  assert.match(src, /confirmKill/)
  assert.match(src, /if \(next && !confirmKill\)/)
})

test('the render config tab is registered in the settings screen', async () => {
  const src = await source('src/pages/admin/AutoPublisherMasterV1Settings.jsx')
  assert.match(src, /\['rendering', 'Renderização'\]/)
  assert.match(src, /tab === 'rendering'[\s\S]*<MasterRenderConfig/)
  // Existing tabs stay.
  assert.match(src, /\['titles', 'Selos da matéria'\]/)
  assert.match(src, /\['sponsors', 'Patrocinadores'\]/)
})

test('Nova materia availability uses isMasterV1Available, not a bare row check', async () => {
  const src = await source('src/pages/admin/AutoPublisher.jsx')
  assert.match(src, /import \{ isMasterV1Available \}/)
  assert.match(src, /sponsorRotationEnabled\s*=\s*useMemo\([\s\S]*isMasterV1Available\(/)
  assert.doesNotMatch(src, /sponsorRotationEnabled\s*=\s*Boolean\(masterConfig\)/)
})
