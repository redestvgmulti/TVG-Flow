const FORMAT_LABELS = Object.freeze({
  feed: 'Feed',
  reels: 'Reels',
  story: 'Stories',
})

export const TERRITORIAL_COMPOSER_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  DISABLED: 'disabled',
  READY: 'ready',
  ERROR: 'error',
})

export const EMPTY_TERRITORIAL_CATALOG = Object.freeze({
  available_formats: [],
  regions: [],
  cities: [],
  visual_titles: [],
  manual_assets: [],
})

function isMissingComposerSchema(error) {
  const raw = `${error?.code || ''} ${error?.message || ''}`
  return /42P01|PGRST205|territorial_composer_features.*does not exist|Could not find.*territorial_composer_features/i.test(raw)
}

function normalizeCatalog(catalog) {
  const value = catalog && typeof catalog === 'object' ? catalog : {}
  return {
    available_formats: Array.isArray(value.available_formats)
      ? value.available_formats.map(item => ({
        ...item,
        slug: item.content_type,
        label: FORMAT_LABELS[item.content_type] || item.content_type,
      }))
      : [],
    regions: Array.isArray(value.regions) ? value.regions : [],
    cities: Array.isArray(value.cities) ? value.cities : [],
    visual_titles: Array.isArray(value.visual_titles) ? value.visual_titles : [],
    manual_assets: Array.isArray(value.manual_assets) ? value.manual_assets : [],
  }
}

export async function loadTerritorialComposer(supabase, clienteId) {
  if (!clienteId) {
    return {
      enabled: false,
      status: TERRITORIAL_COMPOSER_STATUS.DISABLED,
      catalog: EMPTY_TERRITORIAL_CATALOG,
    }
  }

  const { data: flag, error: flagError } = await supabase
    .schema('ap')
    .from('territorial_composer_features')
    .select('enabled')
    .eq('cliente_id', clienteId)
    .maybeSingle()

  if (flagError) {
    if (isMissingComposerSchema(flagError)) {
      return {
        enabled: false,
        status: TERRITORIAL_COMPOSER_STATUS.DISABLED,
        catalog: EMPTY_TERRITORIAL_CATALOG,
      }
    }
    throw flagError
  }

  if (flag?.enabled !== true) {
    return {
      enabled: false,
      status: TERRITORIAL_COMPOSER_STATUS.DISABLED,
      catalog: EMPTY_TERRITORIAL_CATALOG,
    }
  }

  const { data, error } = await supabase
    .schema('ap')
    .rpc('get_territorial_composer_catalog', { p_cliente_id: clienteId })
  if (error) throw error
  const catalog = normalizeCatalog(data)
  const configuredFormats = new Set(
    catalog.available_formats.map(item => item.content_type),
  )
  if (
    configuredFormats.size !== 3 ||
    !['feed', 'reels', 'story'].every(format =>
      configuredFormats.has(format))
  ) {
    throw new Error(
      'Configure um template ativo para Feed, Reels e Stories antes de usar o compositor territorial.',
    )
  }

  return {
    enabled: true,
    status: TERRITORIAL_COMPOSER_STATUS.READY,
    catalog,
  }
}

export function territorialAssetPublicUrl(supabase, asset) {
  if (!asset?.bucket || !asset?.path) return ''
  return supabase.storage.from(asset.bucket).getPublicUrl(asset.path).data?.publicUrl || ''
}

export function composerRequiresSourceImage(catalog, contentType) {
  return Boolean(
    catalog?.available_formats?.find(item => item.content_type === contentType)
      ?.requires_source_image,
  )
}

export function composerFormErrors(formData, catalog) {
  const errors = {}
  const mode = formData.composer_mode
  const contentType = formData.content_type
  const formats = catalog?.available_formats || []

  if (!formats.some(item => item.content_type === contentType)) {
    errors.content_type = 'Selecione um formato disponível.'
  }
  if (!['editorial', 'cities', 'individual'].includes(mode)) {
    errors.composer_mode = 'Selecione um modo de composição.'
  } else if (mode === 'editorial') {
    if (!formData.visual_title_id) errors.visual_title_id = 'Selecione um selo editorial.'
    if (!formData.region_id) errors.region_id = 'Selecione uma região.'
  } else if (mode === 'cities') {
    if (!formData.city_id) errors.city_id = 'Selecione uma cidade.'
  } else {
    if (contentType !== 'story' && !formData.visual_title_id) {
      errors.visual_title_id = 'Selecione um selo.'
    }
    const slots = Array.isArray(formData.manual_slots)
      ? formData.manual_slots.filter(slot => slot?.source_id)
      : []
    if (slots.length < 1) errors.manual_slots = 'Preencha pelo menos um slot inferior.'
    if (slots.length > 3) errors.manual_slots = 'Use no máximo três slots inferiores.'
  }
  return errors
}

export function territorialComposerIntent(formData) {
  const manualSlots = Array.isArray(formData.manual_slots)
    ? formData.manual_slots
      .filter(slot => slot?.source_id && slot?.source_type && slot?.slot)
      .map(slot => ({
        slot: slot.slot,
        source_type: slot.source_type,
        source_id: slot.source_id,
      }))
    : []

  return {
    composer_mode: formData.composer_mode,
    region_id: formData.composer_mode === 'editorial' ? formData.region_id || null : null,
    city_id: formData.composer_mode === 'cities' ? formData.city_id || null : null,
    visual_title_id:
      formData.composer_mode === 'editorial' ||
      (formData.composer_mode === 'individual' && formData.content_type !== 'story')
        ? formData.visual_title_id || null
        : null,
    manual_slots: formData.composer_mode === 'individual' ? manualSlots : [],
  }
}
