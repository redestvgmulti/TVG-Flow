import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { slugifySponsor } from '../../src/services/renderSponsors.js'

const root = new URL('../../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')

const MANAGER = 'src/components/editorial/SponsorsManager.jsx'
const SETTINGS = 'src/pages/admin/AutoPublisherMasterV1Settings.jsx'
const SERVICE = 'src/services/renderSponsors.js'

// Assertions about what the surface *does* must not trip over prose that
// explains why, so comments are stripped before matching.
const code = text => text
  .split('\n')
  .filter(line => !line.trimStart().startsWith('//'))
  .join('\n')

// The registration form, isolated from the catalog toolbar below it.
const formBlock = ui => ui.slice(ui.indexOf('<form '), ui.indexOf('</form>'))

test('the form asks for exactly name, PNG and status', async () => {
  const ui = await source(MANAGER)
  assert.match(ui, /Nome do patrocinador/)
  assert.match(ui, /Logo do patrocinador \(PNG\)/)
  assert.match(ui, /Disponível para a rotação/)
  // Three inputs inside the form: name, PNG picker and status switch. The
  // catalog's search box below is not part of the registration form.
  const inputs = formBlock(ui).match(/<input /g) || []
  assert.equal(inputs.length, 2, 'form should hold the name and status inputs')
  // The PNG picker lives in its own component, mounted inside the same form.
  assert.match(formBlock(ui), /<SponsorPngDrop/)
})

test('the identifier is never shown nor typed by the operator', async () => {
  const ui = await source(MANAGER)
  assert.doesNotMatch(ui, /Identificador/)
  assert.doesNotMatch(ui, /form\.slug/)
  assert.doesNotMatch(ui, /sponsor\.slug/)
  // The UI never sends a slug: the database derives it.
  assert.doesNotMatch(ui, /slug:/)
})

test('the slug is derived from the name, mirroring ap.slugify_sponsor', () => {
  assert.equal(slugifySponsor('Clínica Vida'), 'clinica-vida')
  assert.equal(slugifySponsor('  Açaí & Cia --- 2  '), 'acai-cia-2')
  assert.equal(slugifySponsor('São João'), 'sao-joao')
  assert.equal(slugifySponsor(''), '')
})

test('registering goes through the single transactional RPC', async () => {
  const service = await source(SERVICE)
  assert.match(service, /rpc\('create_render_sponsor'/)
  assert.match(service, /p_cliente_id: clienteId/)
  assert.match(service, /p_nome: trimmed/)
  assert.match(service, /p_sha256: asset\.sha256/)
  // Registration must not write the tables directly from the client, which is
  // what used to allow a sponsor without memberships.
  const createBlock = service.slice(
    service.indexOf('export async function createRenderSponsor'),
    service.indexOf('export async function updateRenderSponsor'),
  )
  assert.doesNotMatch(createBlock, /from\('render_sponsors'\)/)
  assert.doesNotMatch(createBlock, /from\('render_sponsor_scope_memberships'\)/)
})

test('the operator never picks a format, an order or a rotation scope', async () => {
  const ui = code(await source(MANAGER))
  const service = code(await source(SERVICE))
  for (const text of [ui, service]) {
    assert.doesNotMatch(text, /content_type/)
    assert.doesNotMatch(text, /template_set/)
    assert.doesNotMatch(text, /ordem/)
    assert.doesNotMatch(text, /membership/i)
    assert.doesNotMatch(text, /Adicionar à rotação/)
  }
  // No format picker reaches the operator: eligibility is automatic.
  assert.doesNotMatch(ui, /value="feed"/)
  assert.doesNotMatch(ui, /value="reels"/)
})

test('the settings page no longer manages memberships at all', async () => {
  const settings = await source(SETTINGS)
  assert.match(settings, /<SponsorsManager clienteId=\{clienteId\} \/>/)
  assert.doesNotMatch(settings, /render_sponsor_scope_memberships/)
  assert.doesNotMatch(settings, /onConflict/)
  assert.doesNotMatch(settings, /template_set/)
  assert.doesNotMatch(settings, /ordem/)
  assert.doesNotMatch(settings, /ROTATION_TEMPLATE_SET/)
  // The technical master controls stay out of the operator surface.
  assert.doesNotMatch(settings, /layerMap/)
  assert.doesNotMatch(settings, /master_template_uuid/)
  assert.doesNotMatch(settings, /'rendering'/)
})

test('availability is a flag on the sponsor, never a membership edit', async () => {
  const service = await source(SERVICE)
  assert.match(service, /export async function setRenderSponsorActive/)
  const block = service.slice(service.indexOf('export async function setRenderSponsorActive'))
  assert.match(block, /updateRenderSponsor\(supabase, clienteId, sponsorId, \{ ativo \}\)/)
  // Deactivating must not delete or reorder anything.
  assert.doesNotMatch(block, /delete\(\)/)
  assert.doesNotMatch(block, /ordem/)
})

test('replacing the PNG only moves the pointer forward, never rewrites history', async () => {
  const service = await source(SERVICE)
  const block = service.slice(
    service.indexOf('export async function updateRenderSponsor'),
    service.indexOf('export async function setRenderSponsorActive'),
  )
  // A replacement writes new immutable asset columns on the sponsor row only.
  assert.match(block, /asset_bucket: asset\.bucket/)
  assert.match(block, /sha256: asset\.sha256/)
  assert.doesNotMatch(block, /candidate_news/)
  assert.doesNotMatch(block, /render_snapshot/)
})

test('the PNG is normalized in the browser and the hash covers the final file', async () => {
  const ui = await source(MANAGER)
  assert.match(ui, /normalizeSeloPng\(/)
  // Only the normalized result is handed over for upload.
  assert.match(ui, /onChange\(result\.file\)/)
  const service = await source(SERVICE)
  assert.match(service, /uploadImmutablePng\(\{/)
  assert.match(service, /kind: 'sponsors'/)
})

test('every write is scoped to the operational client', async () => {
  const service = await source(SERVICE)
  assert.match(service, /\.eq\('cliente_id', clienteId\)/)
  assert.match(service, /p_cliente_id: clienteId/)
  // No hardcoded tenant may leak into the administration surface.
  assert.doesNotMatch(service, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
  const ui = await source(MANAGER)
  assert.doesNotMatch(ui, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
})

test('legacy ap.patrocinadores is never read or written by the new surface', async () => {
  for (const path of [MANAGER, SETTINGS, SERVICE]) {
    const text = await source(path)
    assert.doesNotMatch(text, /from\('patrocinadores'\)/)
    assert.doesNotMatch(text, /ap\.patrocinadores/)
  }
})
