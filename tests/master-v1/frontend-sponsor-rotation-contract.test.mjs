import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
async function source(path) { return readFile(new URL(path, root), 'utf8') }

test('manual form offers the visual model and no technical picker at all', async () => {
  const form = await source('src/components/editorial/ArticleForm.jsx')
  // The visual model selector replaces "Campanha Visual" and the template picker.
  assert.match(form, /Modelo visual/)
  assert.match(form, /formData\.visual_model/)
  assert.match(form, /availableVisualModels\.map/)
  // The operator NEVER picks the sponsor count, a campaign or a template.
  assert.doesNotMatch(form, /Quantidade de patrocinadores/)
  assert.doesNotMatch(form, /formData\.sponsor_count/)
  assert.doesNotMatch(form, /Campanha Visual/)
  assert.doesNotMatch(form, /FALLBACK_CAMPAIGNS/)
  assert.doesNotMatch(form, /Selecionar Template/)
  assert.doesNotMatch(form, /availableTemplates/)
  assert.doesNotMatch(form, /placid_template_uuid/)
  assert.doesNotMatch(form, /template_set/)
})

test('the manual page sends the visual model, never a sponsor_count or a UUID', async () => {
  const page = await source('src/pages/admin/AutoPublisher.jsx')
  assert.match(page, /master_render_controls/)
  assert.match(page, /master_render_configs/)
  // Availability is decided by which models are enabled/complete for the format.
  assert.match(page, /availableVisualModels\s*=\s*useMemo\([\s\S]*availableVisualModelsForFormat\(/)
  assert.match(page, /sponsorRotationEnabled\s*=\s*availableVisualModels\.length\s*>\s*0/)
  assert.match(page, /payload\.visual_model = formData\.visual_model/)
  assert.match(page, /payload\.idempotency_key = idempotencyKey/)
  assert.doesNotMatch(page, /payload\.sponsor_count/)
  assert.doesNotMatch(page, /payload\.placid_template_uuid/)
  assert.doesNotMatch(page, /template_sets/)
  assert.doesNotMatch(page, /availableCampaigns/)
})

test('EmployeeMode reaches the same matrix: model, seal and idempotency, no legacy pickers', async () => {
  const employee = await source('src/pages/admin/EmployeeMode.jsx')
  assert.match(employee, /availableVisualModelsForFormat\(/)
  assert.match(employee, /payload\.visual_model = visual_model/)
  assert.match(employee, /payload\.idempotency_key = idempotencyKey/)
  assert.match(employee, /loadVisualTitleCatalog\(/)
  assert.match(employee, /visual_title_id: visual_title_id \|\| null/)
  assert.doesNotMatch(employee, /payload\.sponsor_count/)
  assert.doesNotMatch(employee, /template_set/)
  assert.doesNotMatch(employee, /placid_template_uuid/)
  assert.doesNotMatch(employee, /availableCampaigns/)
})

test('sponsor administration uses the isolated catalog and one shared rotation scope', async () => {
  const settings = await source('src/pages/admin/AutoPublisherMasterV1Settings.jsx')
  assert.match(settings, /from\('render_sponsors'\)/)
  assert.match(settings, /from\('render_sponsor_scope_memberships'\)/)
  assert.match(settings, /kind: 'sponsors'/)
  assert.match(settings, /onConflict:\s*'cliente_id,template_set,content_type,sponsor_id'/)
  // TVG and Misto share one pool: the scope is a fixed internal constant and
  // the operator never associates a sponsor with a visual model.
  assert.match(settings, /const ROTATION_TEMPLATE_SET = 'default'/)
  assert.match(settings, /template_set: ROTATION_TEMPLATE_SET/)
  assert.doesNotMatch(settings, /PUBLICATION_VEHICLES/)
  assert.doesNotMatch(settings, /VISUAL_MODELS/)
  assert.doesNotMatch(settings, /template_render_profiles/)
  assert.doesNotMatch(settings, /from\('templates'\)/)
})

test('the operator settings page exposes no technical master controls (no render tab, layer map or UUID editor)', async () => {
  const settings = await source('src/pages/admin/AutoPublisherMasterV1Settings.jsx')
  assert.doesNotMatch(settings, /layerMap/)
  assert.doesNotMatch(settings, /MasterRenderConfig/)
  assert.doesNotMatch(settings, /'rendering'/)
  assert.doesNotMatch(settings, /Renderização/)
  assert.doesNotMatch(settings, /previewSponsor[12]/)
  assert.doesNotMatch(settings, /Layer map/)
  assert.doesNotMatch(settings, /master_template_uuid/)
})

test('no Placid template UUID is hardcoded anywhere in the frontend', async () => {
  const files = [
    'src/components/editorial/ArticleForm.jsx',
    'src/pages/admin/AutoPublisher.jsx',
    'src/pages/admin/EmployeeMode.jsx',
    'src/pages/admin/AutoPublisherMasterV1Settings.jsx',
    'src/services/visualModels.js',
  ]
  for (const path of files) {
    const text = await source(path)
    for (const uuid of ['mzszfje7xdh6l', 'xcxtk9tt7syfd', '3pm4re4blrizh', 'rrbcykdqcrqae']) {
      assert.ok(!text.includes(uuid), `${path} must not hardcode ${uuid}`)
    }
  }
})
