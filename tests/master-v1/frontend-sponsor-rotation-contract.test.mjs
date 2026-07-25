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
  // Availability is decided by isMasterV1Available (enabled + complete + no kill
  // switch), not by a bare row existence check.
  assert.match(page, /sponsorRotationEnabled = useMemo\([\s\S]*isMasterV1Available\(/)
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
  // The upsert target is unchanged; only tolerate the formatter wrapping the
  // onConflict key and its value onto separate lines.
  assert.match(settings, /onConflict:\s*'cliente_id,template_set,content_type,sponsor_id'/)
  assert.doesNotMatch(settings, /template_render_profiles/)
  assert.doesNotMatch(settings, /from\('templates'\)/)
})

test('settings page hides the technical master controls from operators', async () => {
  // fdd927c intentionally removed the raw layer-map editor and the logical
  // sponsor-slot diagnostic from the operator settings page. The sponsor-slot
  // independence invariant itself now lives in the render pipeline and is
  // certified by renderer-snapshot-contract.test.mjs / generator-sponsor-rotation,
  // so the operator UI must no longer expose these technical controls.
  const settings = await source('src/pages/admin/AutoPublisherMasterV1Settings.jsx')
  assert.doesNotMatch(settings, /layerMap/)
  assert.doesNotMatch(settings, /previewSponsor[12]/)
  assert.doesNotMatch(settings, /'diagnostic'/)
  assert.doesNotMatch(settings, /Layer map/)
})
