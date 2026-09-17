/** Persist a generation and exact resolved Placid plan before rendering. */
export async function beginGeneration(supabase, candidateId) {
  const { data, error } = await supabase.schema('ap').rpc('p0_begin_render', { p_candidate_id: candidateId })
  if (error) throw new Error('GENERATION_CLAIM_FAILED')
  return data
}

export function generationAssetPath(clienteId, candidateId, generationId, contentType) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (![clienteId, candidateId, generationId].every(value => uuid.test(value))) throw new Error('INVALID_ASSET_ID')
  if (!['image/png', 'image/jpeg'].includes(contentType)) throw new Error('INVALID_RENDER_MIME')
  return `${clienteId}/${candidateId}/${generationId}.${contentType === 'image/png' ? 'png' : 'jpg'}`
}

export async function uploadGenerationAsset(supabase, path, bytes, contentType) {
  const { error } = await supabase.storage.from('ap-renders').upload(path, bytes, { contentType, upsert: false })
  if (error) throw new Error('RENDER_STORAGE_UPLOAD_FAILED')
}

/** Persist the generation-owned path before the external Storage write. */
export async function reserveGenerationAsset(supabase, generationId, path) {
  const { error } = await supabase.schema('ap').rpc('p0_reserve_render_asset', {
    p_generation_id: generationId,
    p_asset_path: path,
  })
  if (error) throw new Error('RENDER_ASSET_RESERVATION_FAILED')
}
