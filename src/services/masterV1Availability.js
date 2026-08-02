// Pure helpers for the AutoPublisher master_v1 availability contract.
// Template UUIDs, sponsor counts and layer names always come from the tenant's
// ap.master_render_configs row. The browser never derives technical values.

export function nonEmptyLayer(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function sourceImageRequirement(config) {
  if (!config) return 'unknown'
  return nonEmptyLayer(config.layer_map?.news_image) ? 'required' : 'unsupported'
}

export function requiredLayersFor(contentType, sponsorCount = 0, layerMap = {}) {
  const required = ['headline', 'visual_title']
  if (contentType === 'feed' || nonEmptyLayer(layerMap.news_image)) {
    required.push('news_image')
  }
  if (sponsorCount >= 1) required.push('sponsor_1')
  if (sponsorCount >= 2) required.push('sponsor_2')
  return required
}

export function masterV1ConfigIssues(config) {
  if (!config) return ['config']
  const issues = []
  if (!nonEmptyLayer(config.master_template_uuid)) {
    issues.push('master_template_uuid')
  }

  const sponsorCount = config.sponsor_count === null || config.sponsor_count === undefined
    ? Number.NaN
    : Number(config.sponsor_count)
  if (!Number.isInteger(sponsorCount) || sponsorCount < 0 || sponsorCount > 2) {
    issues.push('sponsor_count')
  }

  const layerMap = config.layer_map && typeof config.layer_map === 'object'
    ? config.layer_map
    : {}
  for (const key of requiredLayersFor(
    config.content_type,
    Number.isInteger(sponsorCount) ? sponsorCount : 0,
    layerMap,
  )) {
    if (!nonEmptyLayer(layerMap[key])) issues.push(`layer:${key}`)
  }

  if (config.content_type === 'reels' && nonEmptyLayer(layerMap.news_image)) {
    issues.push('layer:news_image_not_supported')
  }

  const names = [
    'headline', 'news_image', 'visual_title', 'sponsor_1', 'sponsor_2',
  ].map(key => layerMap[key]).filter(nonEmptyLayer).map(value => value.trim())
  if (new Set(names).size !== names.length) issues.push('layer_collision')
  return issues
}

export function masterV1AvailabilityIssues(config, control, poolSize) {
  if (!config) return ['config']
  if (control?.kill_switch) return ['kill_switch']
  if (config.enabled !== true) return ['disabled']
  const issues = masterV1ConfigIssues(config)
  const sponsorCount = config.sponsor_count === null || config.sponsor_count === undefined
    ? Number.NaN
    : Number(config.sponsor_count)
  if (
    Number.isInteger(sponsorCount) &&
    Number.isInteger(poolSize) &&
    poolSize < sponsorCount
  ) {
    issues.push('sponsor_pool')
  }
  return issues
}

export function isMasterV1Available(config, control, poolSize) {
  return masterV1AvailabilityIssues(config, control, poolSize).length === 0
}

export function masterV1Status(config, control, poolSize) {
  const issues = masterV1AvailabilityIssues(config, control, poolSize)
  if (issues.includes('config')) return 'no_config'
  if (issues.includes('kill_switch')) return 'kill_switch'
  if (issues.includes('disabled')) return 'disabled'
  if (issues.includes('sponsor_pool')) return 'sponsor_pool'
  if (issues.length > 0) return 'incomplete'
  return 'active'
}

export function masterV1UnavailableMessage(config, control, poolSize) {
  const status = masterV1Status(config, control, poolSize)
  if (status === 'sponsor_pool') return 'Indisponível: patrocinadores insuficientes.'
  if (status === 'active') return ''
  if (status === 'no_config') return 'Indisponível para este formato.'
  if (status === 'disabled') return 'Indispon\u00edvel: aguardando homologa\u00e7\u00e3o.'
  return 'Indisponível: configuração incompleta.'
}
