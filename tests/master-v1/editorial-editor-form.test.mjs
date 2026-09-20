import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDraftPayload,
  buildFinalizePayload,
  buildOriginPayload,
  buildProductionIntentPayload,
  composerModeFromFields,
  emptyForm,
  initialFormFromArticle,
  scrapedResultToDraftFields,
  validateContentStep,
  validateOriginStep,
  validateProductionIntentStep,
} from '../../src/services/editorialArticleForm.js'

test('composerModeFromFields infers the UI-only composer mode from persisted columns', () => {
  assert.equal(composerModeFromFields({ region_id: 'r1', city_id: null, manual_slots: [] }), 'editorial')
  assert.equal(composerModeFromFields({ region_id: null, city_id: 'c1', manual_slots: [] }), 'cities')
  assert.equal(composerModeFromFields({ region_id: null, city_id: null, manual_slots: [{ slot: 'footer_slot_1', source_type: 'sponsor', source_id: 's1' }] }), 'individual')
  assert.equal(composerModeFromFields({ region_id: null, city_id: null, manual_slots: [] }), null)
  assert.equal(composerModeFromFields({ region_id: 'r1', city_id: 'c1', manual_slots: [] }), null, 'ambiguous combination is not asserted as any single mode')
})

test('initialFormFromArticle maps an RPC row onto editable form fields, including composer_mode inference', () => {
  const row = {
    origin_type: 'link', origin_reference: 'https://site.com/n', production_input_type: 'link',
    headline: 'Título', body: 'Corpo da matéria', content_type: 'feed', visual_model: 'tvg',
    visual_title_id: 'vt1', region_id: 'r1', city_id: null, manual_slots: [], source_image_url: 'https://img',
  }
  const form = initialFormFromArticle(row)
  assert.equal(form.headline, 'Título')
  assert.equal(form.composer_mode, 'editorial')
  assert.equal(form.region_id, 'r1')
})

test('initialFormFromArticle with no article returns the same shape as emptyForm', () => {
  assert.deepEqual(initialFormFromArticle(null), emptyForm())
})

test('validateOriginStep: text origin rejects a reference, link/image origins require an http(s) URL', () => {
  assert.deepEqual(validateOriginStep({ origin_type: 'text', origin_reference: '' }), {})
  assert.ok(validateOriginStep({ origin_type: 'text', origin_reference: 'https://x' }).origin_reference)
  assert.ok(validateOriginStep({ origin_type: 'link', origin_reference: '' }).origin_reference)
  assert.ok(validateOriginStep({ origin_type: 'link', origin_reference: 'ftp://x' }).origin_reference)
  assert.deepEqual(validateOriginStep({ origin_type: 'link', origin_reference: 'https://site.com' }), {})
  assert.ok(validateOriginStep({ origin_type: 'bogus', origin_reference: '' }).origin_type)
})

test('buildOriginPayload strips the reference for text origin and trims it otherwise', () => {
  assert.deepEqual(
    buildOriginPayload({ origin_type: 'text', origin_reference: '  ' }, { requestId: 'req-1' }),
    { originType: 'text', originReference: null, requestId: 'req-1' },
  )
  assert.deepEqual(
    buildOriginPayload({ origin_type: 'link', origin_reference: ' https://site.com ' }, { requestId: 'req-1' }),
    { originType: 'link', originReference: 'https://site.com', requestId: 'req-1' },
  )
})

test('validateContentStep enforces a minimum length on headline and body', () => {
  assert.ok(validateContentStep({ headline: 'curto', body: 'x'.repeat(30) }).headline)
  assert.ok(validateContentStep({ headline: 'x'.repeat(10), body: 'curto' }).body)
  assert.deepEqual(validateContentStep({ headline: 'x'.repeat(10), body: 'x'.repeat(30) }), {})
})

test('buildDraftPayload / buildFinalizePayload trim content and carry the expected revision number', () => {
  const form = { headline: '  Título  ', body: '  Corpo  ' }
  const ctx = { articleId: 'a1', requestId: 'r1', expectedRevisionNumber: 2 }
  const expected = {
    articleId: 'a1', headline: 'Título', body: 'Corpo', caption: null,
    contextTag: null, category: null, location: null,
    requestId: 'r1', expectedRevisionNumber: 2,
  }
  assert.deepEqual(buildDraftPayload(form, ctx), expected)
  assert.deepEqual(buildFinalizePayload(form, ctx), expected)
})

test('validateContentStep requires the complete structured AI draft when requested', () => {
  const incomplete = validateContentStep(
    { headline: 'Manchete válida', body: 'Corpo editorial com tamanho suficiente.', caption: '', context_tag: '', category: '' },
    { requireAiFields: true },
  )
  assert.ok(incomplete.caption)
  assert.ok(incomplete.context_tag)
  assert.ok(incomplete.category)

  assert.deepEqual(validateContentStep({
    headline: 'Manchete válida',
    body: 'Corpo editorial com tamanho suficiente.',
    caption: 'Legenda editorial válida.',
    context_tag: 'gestão pública',
    category: 'Política',
  }, { requireAiFields: true }), {})
})

test('buildProductionIntentPayload: legacy (non-territorial) path passes visual_model/visual_title_id straight through', () => {
  const form = {
    production_input_type: 'link', content_type: 'feed', visual_model: 'tvg', visual_title_id: 'vt1',
    composer_mode: null, region_id: null, city_id: null, manual_slots: [], source_image_url: ' https://img ',
  }
  const payload = buildProductionIntentPayload(form, { articleId: 'a1', requestId: 'r1', territorialComposerEnabled: false })
  assert.equal(payload.visualModel, 'tvg')
  assert.equal(payload.visualTitleId, 'vt1')
  assert.equal(payload.regionId, null)
  assert.equal(payload.sourceImageUrl, 'https://img')
})

test('buildProductionIntentPayload: territorial path gates region/city/manual_slots by composer_mode via territorialComposerIntent', () => {
  const form = {
    production_input_type: 'link', content_type: 'feed', visual_model: '', visual_title_id: 'vt-editorial',
    composer_mode: 'editorial', region_id: 'r1', city_id: 'stale-city', manual_slots: [], source_image_url: '',
  }
  const payload = buildProductionIntentPayload(form, { articleId: 'a1', requestId: 'r1', territorialComposerEnabled: true })
  assert.equal(payload.visualModel, null, 'territorial mode never sends a legacy visual_model')
  assert.equal(payload.regionId, 'r1')
  assert.equal(payload.cityId, null, 'city_id is dropped because composer_mode is editorial, not cities')
  assert.equal(payload.manualSlots, null)
})

test('validateProductionIntentStep delegates to composerFormErrors when territorial is enabled', () => {
  const errors = validateProductionIntentStep(
    { composer_mode: null, content_type: 'feed' },
    { territorialComposerEnabled: true, territorialCatalog: { available_formats: [{ content_type: 'feed' }] } },
  )
  assert.ok(errors.composer_mode)
})

test('validateProductionIntentStep (legacy path) requires content_type, visual_model, visual_title_id and an available config', () => {
  const missing = validateProductionIntentStep({ content_type: '', visual_model: '', visual_title_id: null }, { territorialComposerEnabled: false })
  assert.ok(missing.content_type)
  assert.ok(missing.visual_model)
  assert.ok(missing.visual_title_id)

  const unavailable = validateProductionIntentStep(
    { content_type: 'feed', visual_model: 'tvg', visual_title_id: 'vt1' },
    { territorialComposerEnabled: false, masterConfigs: [], masterControl: {}, poolCounts: {} },
  )
  assert.ok(unavailable.visual_model)
})

test('scrapedResultToDraftFields maps the ap-link-scraper response onto draft fields', () => {
  assert.deepEqual(
    scrapedResultToDraftFields({ title: 'T', content: 'C', image_url: 'https://img' }),
    { headline: 'T', body: 'C', source_image_url: 'https://img' },
  )
  assert.deepEqual(scrapedResultToDraftFields(null), { headline: '', body: '', source_image_url: '' })
})
