export const MASTER_RUNTIME_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
})

export const VISUAL_MODELS_STATE = Object.freeze({
  LOADING: 'loading',
  EMPTY: 'empty',
  ERROR: 'error',
  AVAILABLE: 'available',
})

export class MasterRuntimeLoadError extends Error {
  constructor() {
    super('MASTER_CONFIG_READ_FAILED')
    this.name = 'MasterRuntimeLoadError'
    this.code = 'MASTER_CONFIG_READ_FAILED'
  }
}

// The sponsor rotation scope is shared by every visual model of a format, so
// the eligible pool is counted once per content_type. This is a commercial
// availability signal only: the authority stays the transactional RPC, which
// still fails closed with SPONSOR_POOL_INSUFFICIENT.
export const ROTATION_TEMPLATE_SET = 'default'

export function sponsorPoolSizesFrom(sponsors, memberships) {
  const activeSponsorIds = new Set(
    (sponsors || []).filter(sponsor => sponsor.ativo).map(sponsor => sponsor.id),
  )
  const pools = { feed: 0, reels: 0 }
  for (const membership of memberships || []) {
    if (!membership.ativo) continue
    if (!activeSponsorIds.has(membership.sponsor_id)) continue
    if (membership.content_type in pools) pools[membership.content_type] += 1
  }
  return pools
}

export async function loadMasterRuntime(supabase, clienteId) {
  const [controlsResult, configsResult, sponsorsResult, membershipsResult] =
    await Promise.all([
      supabase
        .schema('ap')
        .from('master_render_controls')
        .select('kill_switch')
        .eq('cliente_id', clienteId)
        .maybeSingle(),
      supabase
        .schema('ap')
        .from('master_render_configs')
        .select('id,content_type,visual_model,master_template_uuid,enabled,layer_map')
        .eq('cliente_id', clienteId)
        .eq('enabled', true),
      supabase
        .schema('ap')
        .from('render_sponsors')
        .select('id,ativo')
        .eq('cliente_id', clienteId)
        .eq('ativo', true),
      supabase
        .schema('ap')
        .from('render_sponsor_scope_memberships')
        .select('sponsor_id,content_type,ativo')
        .eq('cliente_id', clienteId)
        .eq('template_set', ROTATION_TEMPLATE_SET)
        .eq('ativo', true),
    ])

  if (controlsResult.error || configsResult.error) {
    throw new MasterRuntimeLoadError()
  }

  // The pool is advisory: if it cannot be read, availability stays unknown and
  // every enabled model remains selectable.
  const poolReadable = !sponsorsResult.error && !membershipsResult.error
  return {
    configs: configsResult.data || [],
    killSwitch: Boolean(controlsResult.data?.kill_switch),
    sponsorPools: poolReadable
      ? sponsorPoolSizesFrom(sponsorsResult.data, membershipsResult.data)
      : null,
  }
}

export function visualModelsStateFor(runtimeStatus, availableVisualModels) {
  if (runtimeStatus === MASTER_RUNTIME_STATUS.ERROR) {
    return VISUAL_MODELS_STATE.ERROR
  }
  if (
    runtimeStatus === MASTER_RUNTIME_STATUS.IDLE ||
    runtimeStatus === MASTER_RUNTIME_STATUS.LOADING
  ) {
    return VISUAL_MODELS_STATE.LOADING
  }
  return availableVisualModels.length > 0
    ? VISUAL_MODELS_STATE.AVAILABLE
    : VISUAL_MODELS_STATE.EMPTY
}

export function visualModelsBlockMessage(state) {
  if (state === VISUAL_MODELS_STATE.ERROR) {
    return 'Não foi possível carregar os modelos visuais. Tente novamente.'
  }
  if (state === VISUAL_MODELS_STATE.EMPTY) {
    return 'Nenhum modelo visual está habilitado para este formato.'
  }
  return ''
}
