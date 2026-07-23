import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
async function source(path) { return readFile(new URL(path, root), 'utf8') }

test('manual form exposes exactly zero, one and two sponsor choices only for an enabled master contract', async () => {
  const form = await source('src/components/editorial/ArticleForm.jsx')
  assert.match(form, /sponsorRotationEnabled = false/)
  assert.match(form, /Quantidade de patrocinadores/)
  assert.match(form, /option value="0">Nenhum/)
  assert.match(form, /option value="1">1 patrocinador/)
  assert.match(form, /option value="2">2 patrocinadores/)
  assert.match(form, /!sponsorRotationEnabled && formData\.template_set/)
})

test('frontend sends an idempotent sponsor request only after a valid enabled master config exists', async () => {
  const page = await source('src/pages/admin/AutoPublisher.jsx')
  assert.match(page, /master_render_controls/)
  assert.match(page, /master_render_configs/)
  assert.match(page, /const sponsorRotationEnabled = Boolean\(masterConfig\)/)
  assert.match(page, /payload\.sponsor_count = Number\(formData\.sponsor_count \?\? 0\)/)
  assert.match(page, /payload\.idempotency_key = idempotencyKey/)
  assert.match(page, /payload\.placid_template_uuid = null/)
  assert.match(page, /!sponsorRotationEnabled && formData\.template_set === 'individuais'/)
})

test('sponsor administration uses the isolated catalog and campaign-format memberships, not legacy template profiles', async () => {
  const settings = await source('src/pages/admin/AutoPublisherMasterV1Settings.jsx')
  assert.match(settings, /from\('render_sponsors'\)/)
  assert.match(settings, /from\('render_sponsor_scope_memberships'\)/)
  assert.match(settings, /kind: 'sponsors'/)
  assert.match(settings, /onConflict: 'cliente_id,template_set,content_type,sponsor_id'/)
  assert.doesNotMatch(settings, /template_render_profiles/)
  assert.doesNotMatch(settings, /from\('templates'\)/)
})

test('diagnostic keeps sponsor slots independent and omits an absent slot', async () => {
  const settings = await source('src/pages/admin/AutoPublisherMasterV1Settings.jsx')
  assert.match(settings, /if \(first\?\.asset_bucket && first\?\.asset_path && layerMap\.sponsor_1\)/)
  assert.match(settings, /if \(second\?\.asset_bucket && second\?\.asset_path && layerMap\.sponsor_2\)/)
  assert.match(settings, /item\.id !== previewSponsor1/)
  assert.match(settings, /item\.id !== previewSponsor2/)
})
