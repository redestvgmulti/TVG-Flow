// Visual model ("Modelo visual"): the only daily selector that, together with
// the format (Feed/Reels), addresses one of the four fixed Placid templates.
// The model ALSO fixes how many sponsors the rotation applies — the operator
// never chooses the sponsor count separately.
//
//   tvg      → TVG fixa + dois patrocinadores dinâmicos        → 2 patrocinadores
//   tvg_img  → TVG fixa + imagem fixa + um patrocinador        → 1 patrocinador
//
// The model is stored in its own column, ap.master_render_configs.visual_model.
// It is NOT a "campanha visual" and it is NOT template_set: template_set stays
// fixed at 'default' and remains only the internal sponsor-rotation scope, which
// TVG and TVG + IMG deliberately share (one catalog, one pool, one cursor per
// format). Nothing here selects layers or UUIDs in the UI.
import { isMasterV1Available } from './masterV1Availability.js'

export const VISUAL_MODELS = [
  { slug: 'tvg', label: 'TVG', sponsorCount: 2 },
  { slug: 'tvg_img', label: 'TVG + IMG', sponsorCount: 1 },
]

// Historical slug kept ONLY for reading records written before the rename.
// Nothing writes 'misto' anymore: it is never offered, never selectable and
// never sent to the generator. Reading is one-way — snapshots stay untouched.
export const LEGACY_VISUAL_MODEL_ALIASES = Object.freeze({ misto: 'tvg_img' })

const BY_SLUG = new Map(VISUAL_MODELS.map(model => [model.slug, model]))

// Canonical slug for a value that may come from a historical row/snapshot.
// Returns null for anything that is neither a current model nor a known alias.
export function canonicalVisualModel(slug) {
  if (typeof slug !== 'string') return null
  const normalized = slug.trim().toLowerCase()
  const canonical = LEGACY_VISUAL_MODEL_ALIASES[normalized] || normalized
  return BY_SLUG.has(canonical) ? canonical : null
}

// Strict: only the two current models are valid for NEW selections.
export function isVisualModel(slug) {
  return BY_SLUG.has(slug)
}

export function sponsorCountForVisualModel(slug) {
  return BY_SLUG.get(slug)?.sponsorCount ?? null
}

// Labels never expose the historical slug: a legacy 'misto' row reads as
// "TVG + IMG", so no screen can show "Misto" again.
export function visualModelLabel(slug) {
  const canonical = canonicalVisualModel(slug)
  return canonical ? BY_SLUG.get(canonical).label : slug
}

// Commercial availability, expressed without technical detail: TVG needs two
// eligible sponsors, TVG + IMG needs one. `sponsorPoolSize` is the number of
// active sponsors eligible for the format; `null`/`undefined` means the pool is
// unknown, and the option stays selectable so the backend keeps failing closed
// with SPONSOR_POOL_INSUFFICIENT.
export const SPONSOR_POOL_INSUFFICIENT_MESSAGE =
  'Indisponível: patrocinadores insuficientes.'

export function visualModelAvailability(model, sponsorPoolSize) {
  if (sponsorPoolSize === null || sponsorPoolSize === undefined) {
    return { selectable: true, unavailableReason: '' }
  }
  return Number(sponsorPoolSize) >= model.sponsorCount
    ? { selectable: true, unavailableReason: '' }
    : { selectable: false, unavailableReason: SPONSOR_POOL_INSUFFICIENT_MESSAGE }
}

// Models the operator can actually pick for a given format: those whose fixed
// master config exists, is enabled and complete, with the kill switch off.
// `configs` are ap.master_render_configs rows (one per content_type ×
// visual_model). A historical row still holding the legacy slug is matched by
// its canonical model, so the selector keeps working before the migration runs.
export function availableVisualModelsForFormat(
  configs,
  control,
  contentType,
  sponsorPoolSize = null,
) {
  const byModel = new Map()
  for (const config of configs || []) {
    if (config.content_type !== contentType) continue
    const canonical = canonicalVisualModel(config.visual_model)
    if (canonical) byModel.set(canonical, config)
  }
  return VISUAL_MODELS
    .filter(model => isMasterV1Available(byModel.get(model.slug), control))
    .map(model => ({ ...model, ...visualModelAvailability(model, sponsorPoolSize) }))
}

export function selectableVisualModels(models) {
  return (models || []).filter(model => model.selectable !== false)
}

// Single source of truth for the selector state machine:
//   - a still-selectable choice survives a format change;
//   - an invalid one is cleared;
//   - exactly one selectable option is chosen automatically;
//   - two options require an explicit choice.
export function resolveVisualModelSelection(currentSlug, models) {
  const selectable = selectableVisualModels(models)
  if (currentSlug && selectable.some(model => model.slug === currentSlug)) {
    return currentSlug
  }
  return selectable.length === 1 ? selectable[0].slug : ''
}
