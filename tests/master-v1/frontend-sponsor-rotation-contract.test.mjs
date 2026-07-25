import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
async function source(path) { return readFile(new URL(path, root), 'utf8') }

test('manual form offers the publication vehicle (not a sponsor-count picker) when the master rotation is enabled', async () => {
  const form = await source('src/components/editorial/ArticleForm.jsx')
  // The vehicle selector replaces the old "Campanha Visual"/template picker.
  assert.match(form, /Veículo de publicação/)
  assert.match(form, /formData\.veiculo/)
  assert.match(form, /availableVehicles\.map/)
  // The operator NEVER picks the sponsor count: that UI is gone.
  assert.doesNotMatch(form, /Quantidade de patrocinadores/)
  assert.doesNotMatch(form, /formData\.sponsor_count/)
})

test('frontend sends the vehicle (never a sponsor_count) with an idempotency key when the rotation is enabled', async () => {
  const page = await source('src/pages/admin/AutoPublisher.jsx')
  assert.match(page, /master_render_controls/)
  assert.match(page, /master_render_configs/)
  // Availability is decided by which vehicles are enabled/complete for the format.
  assert.match(page, /availableVehicles\s*=\s*useMemo\([\s\S]*availableVehiclesForFormat\(/)
  assert.match(page, /sponsorRotationEnabled\s*=\s*availableVehicles\.length\s*>\s*0/)
  // The payload carries the vehicle + idempotency key, and no sponsor_count.
  assert.match(page, /payload\.veiculo = formData\.veiculo/)
  assert.match(page, /payload\.idempotency_key = idempotencyKey/)
  assert.match(page, /payload\.placid_template_uuid = null/)
  assert.doesNotMatch(page, /payload\.sponsor_count/)
})

test('sponsor administration uses the isolated catalog and vehicle-scoped memberships, not legacy template profiles', async () => {
  const settings = await source('src/pages/admin/AutoPublisherMasterV1Settings.jsx')
  assert.match(settings, /from\('render_sponsors'\)/)
  assert.match(settings, /from\('render_sponsor_scope_memberships'\)/)
  assert.match(settings, /kind: 'sponsors'/)
  // Membership scope is the publication vehicle (stored as template_set).
  assert.match(settings, /PUBLICATION_VEHICLES/)
  assert.match(settings, /onConflict:\s*'cliente_id,template_set,content_type,sponsor_id'/)
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
})
