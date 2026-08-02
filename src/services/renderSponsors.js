// Sponsor administration. The operator supplies a name, a PNG and a status —
// nothing else. The identifier, Feed/Reels/Story eligibility, the rotation scope
// and the ordering are all derived, and registration is a single transactional
// RPC so a sponsor can never exist without its memberships.
import { sha256, uploadImmutablePng } from './masterV1Assets.js'

function humanize(error, fallback) {
  const raw = String(error?.message || '')
  if (/SPONSOR_NAME_REQUIRED|SPONSOR_NAME_INVALID/.test(raw)) {
    return 'Informe o nome do patrocinador.'
  }
  if (/SPONSOR_ASSET_INVALID/.test(raw)) {
    return 'O PNG do patrocinador não pôde ser validado. Envie o arquivo novamente.'
  }
  if (/CLIENT_ACCESS_DENIED|CLIENTE_NOT_FOUND/.test(raw)) {
    return 'Cliente não autorizado para esta operação.'
  }
  if (/duplicate key|render_sponsors_slug_per_cliente/.test(raw)) {
    return 'Já existe um patrocinador com esse nome.'
  }
  return fallback
}

// The Storage path is the SHA-256 of the final PNG, so re-uploading the exact
// same bytes is a no-op rather than an error. That makes a retry after a failed
// registration safe: the object is already there and is identical by content.
async function uploadSponsorPng({ supabase, file, clienteId, slug }) {
  try {
    return await uploadImmutablePng({
      supabase, file, clienteId, kind: 'sponsors', slug,
    })
  } catch (error) {
    const raw = String(error?.message || '')
    const alreadyThere = /already exists|Duplicate|409/i.test(raw)
    if (!alreadyThere) throw error
    // Recompute the same immutable descriptor without touching Storage.
    const hash = await sha256(file)
    return {
      bucket: 'ap-images',
      path: `sponsors/${clienteId}/${slug}/${hash}.png`,
      version: hash.slice(0, 12),
      sha256: hash,
      nome: file.name,
      ativo: true,
    }
  }
}

export async function listRenderSponsors(supabase, clienteId) {
  const { data, error } = await supabase
    .schema('ap')
    .from('render_sponsors')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('nome')
  if (error) throw new Error(humanize(error, 'Não foi possível carregar os patrocinadores.'))
  return data || []
}

// One transactional call: sponsor + Feed, Reels and Story memberships.
// The PNG is uploaded first because Storage is not transactional; on RPC
// failure the object is left orphaned but harmless — it is content-addressed,
// unreferenced, and reused verbatim when the operator retries.
export async function createRenderSponsor(supabase, clienteId, { nome, file, ativo = true }) {
  const trimmed = String(nome || '').trim()
  if (!trimmed) throw new Error('Informe o nome do patrocinador.')
  if (!file) throw new Error('Envie o PNG do patrocinador.')

  const slugHint = slugifySponsor(trimmed) || 'patrocinador'
  const asset = await uploadSponsorPng({ supabase, file, clienteId, slug: slugHint })

  const { data, error } = await supabase.schema('ap').rpc('create_render_sponsor', {
    p_cliente_id: clienteId,
    p_nome: trimmed,
    p_asset_bucket: asset.bucket,
    p_asset_path: asset.path,
    p_asset_version: asset.version,
    p_sha256: asset.sha256,
    p_ativo: Boolean(ativo),
  })
  if (error) throw new Error(humanize(error, 'Não foi possível cadastrar o patrocinador.'))
  return data
}

// Renaming and replacing the PNG are single-row updates, already atomic. The
// memberships are keyed by sponsor_id, so neither touches rotation state, and
// past snapshots keep pointing at the previous immutable asset path.
export async function updateRenderSponsor(supabase, clienteId, sponsorId, { nome, file, ativo }) {
  const payload = {}
  if (typeof nome === 'string' && nome.trim()) payload.nome = nome.trim()
  if (typeof ativo === 'boolean') payload.ativo = ativo

  if (file) {
    const slugHint = slugifySponsor(payload.nome || 'patrocinador') || 'patrocinador'
    const asset = await uploadSponsorPng({ supabase, file, clienteId, slug: slugHint })
    Object.assign(payload, {
      asset_bucket: asset.bucket,
      asset_path: asset.path,
      asset_version: asset.version,
      sha256: asset.sha256,
    })
  }

  if (!Object.keys(payload).length) return null

  const { data, error } = await supabase
    .schema('ap')
    .from('render_sponsors')
    .update(payload)
    .eq('id', sponsorId)
    .eq('cliente_id', clienteId)
    .select()
    .single()
  if (error) throw new Error(humanize(error, 'Não foi possível salvar o patrocinador.'))
  return data
}

// Availability is a flag on the sponsor, never a membership edit: deactivating
// leaves the position untouched so reactivating restores it automatically.
export async function setRenderSponsorActive(supabase, clienteId, sponsorId, ativo) {
  return updateRenderSponsor(supabase, clienteId, sponsorId, { ativo })
}

// Mirrors ap.slugify_sponsor so the UI can preview the same identifier the
// database will derive. The database remains the authority.
export function slugifySponsor(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}
