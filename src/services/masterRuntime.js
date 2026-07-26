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
  const [controlsResult, configsResult] = await Promise.all([
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
  ])

  if (controlsResult.error || configsResult.error) {
    throw new MasterRuntimeLoadError()
  }

  return {
    configs: configsResult.data || [],
    killSwitch: Boolean(controlsResult.data?.kill_switch),
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
