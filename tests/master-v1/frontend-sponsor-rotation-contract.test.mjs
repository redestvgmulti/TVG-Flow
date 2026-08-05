import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
async function source(path) { return readFile(new URL(path, root), 'utf8') }

test('manual form offers artwork purpose and no technical picker at all', async () => {
  const form = await source('src/components/editorial/ArticleForm.jsx')
  // The visual model selector replaces "Campanha Visual" and the template picker.
  assert.match(form, /Finalidade da arte/)
  assert.match(form, /formData\.visual_model/)
  assert.match(form, /visualModelOptions\.map/)
  assert.match(form, /visualModelsState === 'error'/)
  assert.match(form, /visualModelsState === 'empty'/)
  assert.match(form, /disabled=\{isSubmitting \|\| generationBlocked\}/)
  assert.match(form, /onRetryVisualModels/)
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
  assert.match(page, /loadMasterRuntime\(supabase, clienteId\)/)
  // Availability is decided by which models are enabled/complete for the format.
  assert.match(page, /availableVisualModels\s*=\s*useMemo\([\s\S]*availableVisualModelsForFormat\(/)
  assert.match(page, /visualModelsStateFor\(/)
  assert.match(page, /visualModelsState !== 'available'/)
  assert.match(page, /visual_model:\s*formData\.visual_model/)
  assert.match(page, /idempotency_key:\s*idempotencyKey/)
  assert.doesNotMatch(page, /payload\.sponsor_count/)
  assert.doesNotMatch(page, /payload\.placid_template_uuid/)
  assert.doesNotMatch(page, /template_sets/)
  assert.doesNotMatch(page, /availableCampaigns/)
})

test('EmployeeMode reaches the same matrix: model, seal and idempotency, no legacy pickers', async () => {
  const employee = await source('src/pages/admin/EmployeeMode.jsx')
  assert.match(employee, /availableVisualModelsForFormat\(/)
  assert.match(employee, /visualModelsStateFor\(/)
  assert.match(employee, /visualModelsState !== 'available'/)
  assert.match(employee, /visual_model,\s*\r?\n/)
  assert.match(employee, /idempotency_key:\s*idempotencyKey/)
  assert.match(employee, /loadVisualTitleCatalog\(/)
  assert.match(employee, /visual_title_id:\s*visual_title_id \|\| null/)
  assert.doesNotMatch(employee, /payload\.sponsor_count/)
  assert.doesNotMatch(employee, /template_set/)
  assert.doesNotMatch(employee, /placid_template_uuid/)
  assert.doesNotMatch(employee, /availableCampaigns/)
})

test('sponsor administration uses the isolated catalog and one shared rotation scope', async () => {
  // Sponsor administration moved out of the settings page: the catalog is read
  // by its own service and the scope is now decided by the database, so the
  // page must not reach either table any more.
  const settings = await source('src/pages/admin/AutoPublisherMasterV1Settings.jsx')
  assert.doesNotMatch(settings, /from\('render_sponsors'\)/)
  assert.doesNotMatch(settings, /from\('render_sponsor_scope_memberships'\)/)
  assert.doesNotMatch(settings, /template_render_profiles/)
  assert.doesNotMatch(settings, /from\('templates'\)/)

  const service = await source('src/services/renderSponsors.js')
  assert.match(service, /from\('render_sponsors'\)/)
  assert.match(service, /kind: 'sponsors'/)
  // TVG and Misto share one pool. The scope is no longer written by the client
  // at all: ap.create_render_sponsor owns it, so the UI cannot diverge from it.
  assert.match(service, /rpc\('create_render_sponsor'/)
  assert.doesNotMatch(service, /from\('render_sponsor_scope_memberships'\)/)
  assert.doesNotMatch(service, /PUBLICATION_VEHICLES/)
  assert.doesNotMatch(service, /VISUAL_MODELS/)

  const migration = await source(
    'supabase/migrations/20260726150000_create_render_sponsor_transactional.sql',
  )
  assert.match(migration, /v_scope text := 'default'/)
  assert.match(migration, /ARRAY\['feed', 'reels'\]/)
})

test('the operator settings page exposes no technical master controls (no render tab, layer map or UUID editor)', async () => {
  const settings = await source('src/pages/admin/AutoPublisherMasterV1Settings.jsx')
  assert.doesNotMatch(settings, /Finalidades das artes/)
  assert.doesNotMatch(settings, /MasterConfigsManager/)
  assert.doesNotMatch(settings, /'purposes'/)
  assert.match(settings, /useState\('titles'\)/)
  assert.match(settings, /\['titles', 'Selos da matéria'\]/)
  assert.match(settings, /\['sponsors', 'Patrocinadores'\]/)
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
