import { sha256, uploadImmutablePng } from './masterV1Assets.js'

function rawMessage(error) {
  return `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`
}

function humanize(error, fallback) {
  const raw = rawMessage(error)
  if (/TERRITORIAL_FEATURE_DISABLED/.test(raw)) {
    return 'A área de Regiões está desativada para este cliente.'
  }
  if (/AUTHENTICATION_REQUIRED|CLIENT_ACCESS_DENIED|TENANT_MISMATCH/.test(raw)) {
    return 'Você não tem permissão para administrar este cliente.'
  }
  if (/REGION_NAME_REQUIRED/.test(raw)) return 'Informe o nome da região.'
  if (/CITY_NAME_REQUIRED/.test(raw)) return 'Informe o nome da cidade.'
  if (/REGION_ASSET_INVALID/.test(raw)) return 'Envie uma imagem PNG válida para a região.'
  if (/CITY_ASSET_INVALID/.test(raw)) return 'Envie uma imagem PNG válida para a cidade.'
  if (/CITY_VISUAL_TITLE_CONFLICT/.test(raw)) {
    return 'Já existe um selo ativo de cidade com este nome. Revise o selo existente antes de cadastrar a cidade.'
  }
  if (/uq_territorial_regions_cliente_normalized_name|territorial_regions_cliente_slug_key/.test(raw)) {
    return 'Já existe uma região com este nome para o cliente.'
  }
  if (/uq_territorial_cities_cliente_normalized_name|territorial_cities_cliente_slug_key/.test(raw)) {
    return 'Já existe uma cidade com este nome para o cliente.'
  }
  if (/territorial_region_sponsors_owner_unique/.test(raw)) {
    return 'Este patrocinador já está associado à região.'
  }
  if (/REGION_SPONSOR_ASSOCIATION_NOT_FOUND/.test(raw)) {
    return 'A associação com este patrocinador não está mais ativa.'
  }
  if (/CITY_TITLE_TYPE_LOCKED/.test(raw)) {
    return 'O selo vinculado a uma cidade deve permanecer com o tipo Cidade.'
  }
  if (/VISUAL_TITLE_TYPE_INVALID/.test(raw)) return 'Escolha Editorial ou Cidade.'
  if (/CITY_TITLE_MANAGED_BY_TERRITORIAL_RPC/.test(raw)) {
    return 'Este selo é gerenciado pelo cadastro da cidade. Edite-o na área de Regiões.'
  }
  if (error?.code === '23505') return 'Já existe um cadastro com este nome.'
  return fallback
}

export function slugifyTerritorial(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function isMissingFlagColumn(error) {
  return ['42703', 'PGRST200', 'PGRST204'].includes(error?.code)
    || /territorial_admin_enabled.*does not exist|Could not find.*territorial_admin_enabled/i.test(error?.message || '')
}

export async function isTerritorialAdminEnabled(supabase, clienteId) {
  if (!clienteId) return false
  const { data, error } = await supabase
    .schema('ap')
    .from('system_config')
    .select('territorial_admin_enabled')
    .eq('cliente_id', clienteId)
    .maybeSingle()

  // Compatibility with a frontend rollback/deployment that reaches a database
  // where the additive flag column has not been applied yet.
  if (error && isMissingFlagColumn(error)) return false
  if (error) throw new Error(humanize(error, 'Não foi possível verificar a área de Regiões.'))
  return data?.territorial_admin_enabled === true
}

async function listScoped(supabase, table, clienteId, order = 'nome') {
  const { data, error } = await supabase
    .schema('ap')
    .from(table)
    .select('*')
    .eq('cliente_id', clienteId)
    .order(order)
  if (error) throw error
  return data || []
}

export async function listTerritorialRegions(supabase, clienteId) {
  try {
    return await listScoped(supabase, 'territorial_regions', clienteId)
  } catch (error) {
    throw new Error(humanize(error, 'Não foi possível carregar as regiões.'))
  }
}

export async function listTerritorialCities(supabase, clienteId) {
  try {
    return await listScoped(supabase, 'territorial_cities', clienteId)
  } catch (error) {
    throw new Error(humanize(error, 'Não foi possível carregar as cidades.'))
  }
}

export async function listTerritorialRegionSponsors(supabase, clienteId) {
  try {
    return await listScoped(supabase, 'territorial_region_sponsors', clienteId, 'created_at')
  } catch (error) {
    throw new Error(humanize(error, 'Não foi possível carregar os patrocinadores das regiões.'))
  }
}

// Storage is intentionally outside the database transaction. A failed RPC can
// leave only an unreferenced, content-addressed object; retrying the exact file
// reuses the same immutable descriptor.
export async function uploadTerritorialPng({
  supabase,
  file,
  clienteId,
  kind,
  slug,
}) {
  if (!['regions', 'cities'].includes(kind)) throw new Error('Tipo de imagem territorial inválido.')
  const safeSlug = slugifyTerritorial(slug) || (kind === 'regions' ? 'regiao' : 'cidade')
  try {
    return await uploadImmutablePng({
      supabase,
      file,
      clienteId,
      kind,
      slug: safeSlug,
    })
  } catch (error) {
    if (!/already exists|duplicate|409/i.test(error?.message || '')) throw error
    const hash = await sha256(file)
    return {
      bucket: 'ap-images',
      path: `${kind}/${clienteId}/${safeSlug}/${hash}.png`,
      version: hash.slice(0, 12),
      sha256: hash,
      nome: file.name,
      ativo: true,
    }
  }
}

export function assetFromTerritorialRecord(record) {
  if (!record) return null
  return {
    bucket: record.asset_bucket,
    path: record.asset_path,
    version: record.asset_version,
    sha256: record.sha256,
  }
}

function assetParams(asset, metadata) {
  if (!asset?.bucket || !asset?.path || !asset?.version || !asset?.sha256) {
    throw new Error('Envie a imagem PNG obrigatória.')
  }
  return {
    p_asset_bucket: asset.bucket,
    p_asset_path: asset.path,
    p_asset_version: asset.version,
    p_sha256: asset.sha256,
    p_asset_metadata: metadata || {},
  }
}

async function callRpc(supabase, name, params, fallback) {
  const { data, error } = await supabase.schema('ap').rpc(name, params)
  if (error) throw new Error(humanize(error, fallback))
  return data
}

export function createTerritorialRegion(supabase, clienteId, { nome, asset, assetMetadata }) {
  return callRpc(supabase, 'create_territorial_region', {
    p_cliente_id: clienteId,
    p_nome: nome,
    ...assetParams(asset, assetMetadata),
    p_ativo: true,
  }, 'Não foi possível cadastrar a região.')
}

export function updateTerritorialRegion(supabase, regionId, { nome, asset, assetMetadata }) {
  return callRpc(supabase, 'update_territorial_region', {
    p_region_id: regionId,
    p_nome: nome,
    ...assetParams(asset, assetMetadata),
  }, 'Não foi possível salvar a região.')
}

export function setTerritorialRegionActive(supabase, regionId, ativo) {
  return callRpc(supabase, 'set_territorial_region_active', {
    p_region_id: regionId,
    p_ativo: Boolean(ativo),
  }, 'Não foi possível atualizar a região.')
}

export function createTerritorialCity(supabase, regionId, { nome, asset, assetMetadata }) {
  return callRpc(supabase, 'create_territorial_city', {
    p_region_id: regionId,
    p_nome: nome,
    ...assetParams(asset, assetMetadata),
    p_ativo: true,
  }, 'Não foi possível cadastrar a cidade.')
}

export function updateTerritorialCity(supabase, cityId, regionId, {
  nome,
  asset,
  assetMetadata,
}) {
  return callRpc(supabase, 'update_territorial_city', {
    p_city_id: cityId,
    p_region_id: regionId,
    p_nome: nome,
    ...assetParams(asset, assetMetadata),
  }, 'Não foi possível salvar a cidade.')
}

export function setTerritorialCityActive(supabase, cityId, ativo) {
  return callRpc(supabase, 'set_territorial_city_active', {
    p_city_id: cityId,
    p_ativo: Boolean(ativo),
  }, 'Não foi possível atualizar a cidade.')
}

export function setTerritorialRegionSponsor(supabase, regionId, sponsorId, ativo) {
  return callRpc(supabase, 'set_territorial_region_sponsor', {
    p_region_id: regionId,
    p_sponsor_id: sponsorId,
    p_ativo: Boolean(ativo),
  }, 'Não foi possível atualizar o patrocinador da região.')
}

export function setVisualTitleType(supabase, visualTitleId, tipo) {
  return callRpc(supabase, 'set_visual_title_type', {
    p_visual_title_id: visualTitleId,
    p_tipo: tipo,
  }, 'Não foi possível atualizar o tipo do selo.')
}
