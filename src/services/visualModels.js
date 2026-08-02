// Business-facing purposes for AutoPublisher artwork. Technical template UUID,
// sponsor count and layer map are resolved from ap.master_render_configs.
import {
  isMasterV1Available,
  masterV1UnavailableMessage,
  sourceImageRequirement,
} from './masterV1Availability.js'

export const VISUAL_MODELS = Object.freeze([
  { slug: 'tvg', label: 'TVG', formats: ['feed', 'reels'] },
  { slug: 'tvg_img', label: 'TVG + IMG', formats: ['feed', 'reels'] },
  { slug: 'individual', label: 'Individual', formats: ['feed', 'reels'] },
  { slug: 'aparecida', label: 'Aparecida', formats: ['reels'] },
  { slug: 'story', label: 'Story', formats: ['story'] },
])

export const CONTENT_TYPES = Object.freeze([
  { slug: 'feed', label: 'Feed' },
  { slug: 'reels', label: 'Reels' },
  { slug: 'story', label: 'Story' },
])

const BY_SLUG = new Map(VISUAL_MODELS.map(model => [model.slug, model]))

export function isVisualModel(slug) {
  return BY_SLUG.has(slug)
}

export function visualModelLabel(slug) {
  if (slug === 'misto') return 'TVG + IMG'
  return BY_SLUG.get(slug)?.label ?? slug
}

export function visualModelsForFormat(contentType) {
  return VISUAL_MODELS.filter(model => model.formats.includes(contentType))
}

function poolSizeFor(poolCounts, contentType) {
  const value = poolCounts?.[contentType]
  return Number.isInteger(value) ? value : undefined
}

export function visualModelOptionsForFormat(
  configs,
  control,
  contentType,
  poolCounts = {},
) {
  const byModel = new Map(
    (configs || [])
      .filter(config => config.content_type === contentType)
      .map(config => [config.visual_model, config]),
  )
  return visualModelsForFormat(contentType).map(model => {
    const config = byModel.get(model.slug) || null
    const poolSize = poolSizeFor(poolCounts, contentType)
    const available = isMasterV1Available(config, control, poolSize)
    return {
      ...model,
      config,
      available,
      unavailableReason: available
        ? ''
        : masterV1UnavailableMessage(config, control, poolSize),
      sourceImage: sourceImageRequirement(config),
    }
  })
}

export function availableVisualModelsForFormat(
  configs,
  control,
  contentType,
  poolCounts = {},
) {
  return visualModelOptionsForFormat(
    configs,
    control,
    contentType,
    poolCounts,
  ).filter(model => model.available)
}

export function availableContentTypes(configs, control) {
  if (control?.kill_switch) return []
  return CONTENT_TYPES.filter(format => {
    const allowed = new Set(visualModelsForFormat(format.slug).map(model => model.slug))
    return (configs || []).some(config =>
      config.content_type === format.slug &&
      config.enabled === true &&
      allowed.has(config.visual_model),
    )
  })
}

export function nextVisualModel(currentModel, availableModels) {
  if (availableModels.some(model => model.slug === currentModel)) {
    return currentModel
  }
  return availableModels.length === 1 ? availableModels[0].slug : ''
}
