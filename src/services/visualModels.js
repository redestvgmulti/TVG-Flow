// Visual model ("Modelo visual"): the only daily selector that, together with
// the format (Feed/Reels), addresses one of the four fixed Placid templates.
// The model ALSO fixes how many sponsors the rotation applies — the operator
// never chooses the sponsor count separately.
//
//   tvg    → TVG fixa + dois patrocinadores dinâmicos          → 2 patrocinadores
//   misto  → TVG fixa + imagem fixa + um patrocinador           → 1 patrocinador
//
// The model is stored in its own column, ap.master_render_configs.visual_model.
// It is NOT a "campanha visual" and it is NOT template_set: template_set stays
// fixed at 'default' and remains only the internal sponsor-rotation scope, which
// TVG and TVG + IMG deliberately share (one catalog, one pool, one cursor per
// format). Nothing here selects layers or UUIDs in the UI.
import { isMasterV1Available } from './masterV1Availability.js'

export const VISUAL_MODELS = [
  { slug: 'tvg', label: 'TVG', sponsorCount: 2 },
  { slug: 'misto', label: 'TVG + IMG', sponsorCount: 1 },
]

const BY_SLUG = new Map(VISUAL_MODELS.map(model => [model.slug, model]))

export function isVisualModel(slug) {
  return BY_SLUG.has(slug)
}

export function sponsorCountForVisualModel(slug) {
  return BY_SLUG.get(slug)?.sponsorCount ?? null
}

export function visualModelLabel(slug) {
  return BY_SLUG.get(slug)?.label ?? slug
}

// Models the operator can actually pick for a given format: those whose fixed
// master config exists, is enabled and complete, with the kill switch off.
// `configs` are ap.master_render_configs rows (one per content_type ×
// visual_model).
export function availableVisualModelsForFormat(configs, control, contentType) {
  const byModel = new Map(
    (configs || [])
      .filter(config => config.content_type === contentType)
      .map(config => [config.visual_model, config]),
  )
  return VISUAL_MODELS.filter(model =>
    isMasterV1Available(byModel.get(model.slug), control),
  )
}
