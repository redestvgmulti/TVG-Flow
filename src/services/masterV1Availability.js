// Pure, testable helpers that decide whether the master_v1 render path is
// actually available for a tenant/content_type. Layer names stay data-driven
// (the real values live in ap.master_render_configs.layer_map) — nothing here
// hardcodes Placid layer names.
//
// A row existing in the database is NOT enough: the config must be enabled,
// complete for its content_type, and the kill switch must be off.

export function nonEmptyLayer(value) {
  return typeof value === 'string' && value.trim().length > 0
}

// Layers required to ENABLE a config, per content_type. Mirrors the renderer
// contract (renderContract.validateLayerMap): feed needs news_image; reels
// forbids news_image/tag; both need headline + visual_title; the sponsor flow
// needs sponsor_1 (sponsor_2 stays optional).
export function requiredLayersFor(contentType) {
  return contentType === 'reels'
    ? ['headline', 'visual_title', 'sponsor_1']
    : ['headline', 'news_image', 'visual_title', 'sponsor_1']
}

// Returns an array of missing-requirement codes; empty means the config is
// complete enough to be enabled. Codes: 'config', 'master_template_uuid',
// 'layer:<key>'.
export function masterV1ConfigIssues(config) {
  if (!config) return ['config']
  const issues = []
  if (!nonEmptyLayer(config.master_template_uuid)) {
    issues.push('master_template_uuid')
  }
  const layerMap = config.layer_map || {}
  for (const key of requiredLayersFor(config.content_type)) {
    if (!nonEmptyLayer(layerMap[key])) {
      issues.push(`layer:${key}`)
    }
  }
  return issues
}

// The master_v1 path is available for generation only when the config exists,
// is enabled, is complete, and no kill switch is active.
export function isMasterV1Available(config, control) {
  if (control?.kill_switch) return false
  if (!config || config.enabled !== true) return false
  return masterV1ConfigIssues(config).length === 0
}

// Human-readable status used by the admin screen (never technical layer keys).
export function masterV1Status(config, control) {
  if (!config) return 'no_config'
  if (control?.kill_switch) return 'kill_switch'
  if (config.enabled !== true) return 'disabled'
  if (masterV1ConfigIssues(config).length > 0) return 'incomplete'
  return 'active'
}
