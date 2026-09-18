// Pure mapping between the canonical editor's local form state and the
// ap.editorial_articles / ap.editorial_article_revisions RPC contract. Field
// names deliberately match the RPC/table columns (snake_case) so this form
// state can be handed directly to the reused TerritorialComposerFields /
// VisualTitleCombobox components without an adapter layer.
import { composerFormErrors, territorialComposerIntent } from './territorialComposer.js'
import { isMasterV1Available } from './masterV1Availability.js'

const ORIGIN_TYPES = ['link', 'text', 'image']

export function emptyForm(originType = null) {
  return {
    origin_type: originType,
    origin_reference: '',
    production_input_type: originType,
    headline: '',
    body: '',
    content_type: '',
    visual_model: '',
    visual_title_id: null,
    composer_mode: null,
    region_id: null,
    city_id: null,
    manual_slots: [],
    source_image_url: '',
  }
}

// Reverses composerModeFromArticle.ts's inference (a Deno file in
// supabase/functions/, not importable from the Vite bundle) so an existing
// territorial article reopens with the right composer mode pre-selected.
export function composerModeFromFields({ region_id, city_id, manual_slots }) {
  const hasRegion = Boolean(region_id)
  const hasCity = Boolean(city_id)
  const hasManualSlots = Array.isArray(manual_slots) && manual_slots.length > 0
  if (hasRegion && !hasCity && !hasManualSlots) return 'editorial'
  if (hasCity && !hasRegion && !hasManualSlots) return 'cities'
  if (hasManualSlots && !hasRegion && !hasCity) return 'individual'
  return null
}

export function initialFormFromArticle(row) {
  if (!row) return emptyForm()
  return {
    origin_type: row.origin_type || null,
    origin_reference: row.origin_reference || '',
    production_input_type: row.production_input_type || row.origin_type || null,
    headline: row.headline || '',
    body: row.body || '',
    content_type: row.content_type || '',
    visual_model: row.visual_model || '',
    visual_title_id: row.visual_title_id || null,
    composer_mode: composerModeFromFields(row),
    region_id: row.region_id || null,
    city_id: row.city_id || null,
    manual_slots: Array.isArray(row.manual_slots) ? row.manual_slots : [],
    source_image_url: row.source_image_url || '',
  }
}

export function validateOriginStep({ origin_type, origin_reference }) {
  const errors = {}
  if (!ORIGIN_TYPES.includes(origin_type)) {
    errors.origin_type = 'Selecione a origem da matéria.'
    return errors
  }
  const reference = (origin_reference || '').trim()
  if (origin_type === 'text' && reference) {
    errors.origin_reference = 'Origem de texto não usa link.'
  }
  if ((origin_type === 'link' || origin_type === 'image') && !/^https?:\/\//.test(reference)) {
    errors.origin_reference = 'Informe uma URL válida (http:// ou https://).'
  }
  return errors
}

export function buildOriginPayload(form, { requestId }) {
  return {
    originType: form.origin_type,
    originReference: form.origin_type === 'text' ? null : (form.origin_reference || '').trim(),
    requestId,
  }
}

export function validateContentStep({ headline, body }) {
  const errors = {}
  if ((headline || '').trim().length < 8) {
    errors.headline = 'A manchete precisa ter pelo menos 8 caracteres.'
  }
  if ((body || '').trim().length < 20) {
    errors.body = 'O corpo precisa ter pelo menos 20 caracteres.'
  }
  return errors
}

export function buildDraftPayload(form, { articleId, requestId, expectedRevisionNumber = null }) {
  return {
    articleId,
    headline: (form.headline || '').trim(),
    body: (form.body || '').trim(),
    requestId,
    expectedRevisionNumber,
  }
}

export function buildFinalizePayload(form, { articleId, requestId, expectedRevisionNumber = null }) {
  return {
    articleId,
    headline: (form.headline || '').trim(),
    body: (form.body || '').trim(),
    requestId,
    expectedRevisionNumber,
  }
}

export function validateProductionIntentStep(form, {
  territorialComposerEnabled,
  territorialCatalog,
  masterConfigs,
  masterControl,
  poolCounts,
} = {}) {
  if (territorialComposerEnabled) {
    return composerFormErrors(form, territorialCatalog)
  }
  const errors = {}
  if (!form.content_type) errors.content_type = 'Selecione um formato.'
  if (!form.visual_model) errors.visual_model = 'Selecione a finalidade da arte.'
  if (form.content_type && form.visual_model) {
    const config = (masterConfigs || []).find(
      item => item.content_type === form.content_type && item.visual_model === form.visual_model,
    )
    const poolSize = poolCounts?.[form.content_type]
    if (!isMasterV1Available(config, masterControl, poolSize)) {
      errors.visual_model = 'Este modelo não está disponível no momento.'
    }
  }
  if (!form.visual_title_id) errors.visual_title_id = 'Selecione um selo.'
  return errors
}

export function buildProductionIntentPayload(form, { articleId, requestId, territorialComposerEnabled }) {
  const territorial = territorialComposerEnabled ? territorialComposerIntent(form) : null
  return {
    articleId,
    productionInputType: form.production_input_type || form.origin_type,
    contentType: form.content_type || null,
    visualModel: territorialComposerEnabled ? null : (form.visual_model || null),
    visualTitleId: territorialComposerEnabled ? territorial.visual_title_id : (form.visual_title_id || null),
    regionId: territorialComposerEnabled ? territorial.region_id : null,
    cityId: territorialComposerEnabled ? territorial.city_id : null,
    manualSlots: territorialComposerEnabled && territorial.manual_slots.length ? territorial.manual_slots : null,
    sourceImageUrl: (form.source_image_url || '').trim() || null,
    requestId,
  }
}

export function scrapedResultToDraftFields(scrapeResult) {
  return {
    headline: scrapeResult?.title || '',
    body: scrapeResult?.content || '',
    source_image_url: scrapeResult?.image_url || '',
  }
}
