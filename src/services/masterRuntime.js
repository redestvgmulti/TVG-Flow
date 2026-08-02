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

export async function loadMasterRuntime(supabase, clienteId) {
  const [controlsResult, configsResult, membershipsResult, sponsorsResult] = await Promise.all([
    supabase
      .schema('ap')
      .from('master_render_controls')
      .select('kill_switch')
      .eq('cliente_id', clienteId)
      .maybeSingle(),
    supabase
      .schema('ap')
      .from('master_render_configs')
      .select('id,content_type,visual_model,master_template_uuid,enabled,layer_map,sponsor_count')
      .eq('cliente_id', clienteId),
    supabase
      .schema('ap')
      .from('render_sponsor_scope_memberships')
      .select('sponsor_id,content_type,ativo')
      .eq('cliente_id', clienteId)
      .eq('template_set', 'default')
      .eq('ativo', true),
    supabase
      .schema('ap')
      .from('render_sponsors')
      .select('id,ativo')
      .eq('cliente_id', clienteId)
      .eq('ativo', true),
  ])

  if (
    controlsResult.error || configsResult.error ||
    membershipsResult.error || sponsorsResult.error
  ) {
    throw new MasterRuntimeLoadError()
  }

  const activeSponsorIds = new Set(
    (sponsorsResult.data || []).map(sponsor => sponsor.id),
  )
  const sponsorsByFormat = new Map()
  for (const membership of membershipsResult.data || []) {
    if (!activeSponsorIds.has(membership.sponsor_id)) continue
    if (!sponsorsByFormat.has(membership.content_type)) {
      sponsorsByFormat.set(membership.content_type, new Set())
    }
    sponsorsByFormat.get(membership.content_type).add(membership.sponsor_id)
  }

  return {
    configs: configsResult.data || [],
    killSwitch: Boolean(controlsResult.data?.kill_switch),
    poolCounts: Object.fromEntries(
      ['feed', 'reels', 'story'].map(format => [
        format,
        sponsorsByFormat.get(format)?.size || 0,
      ]),
    ),
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
