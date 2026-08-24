import { assetPreviewUrl } from './masterV1Assets.js'

const COLLATOR = new Intl.Collator('pt-BR')

function compareByOrderAndName(left, right) {
  return Number(left.ordem || 0) - Number(right.ordem || 0) || COLLATOR.compare(left.nome, right.nome)
}

function normalizedName(value) {
  return String(value || '').trim().toLocaleLowerCase('pt-BR')
}

export function isVisualTitleCompatible(title, contentType) {
  return Array.isArray(title?.formatos) && title.formatos.includes(contentType)
}

export function prepareVisualTitleCatalog(groups, titles, previewForTitle = () => null) {
  const activeGroups = (groups || []).filter(group => group.ativo)
  const indexed = new Map(activeGroups.map(group => [group.id, { ...group, titles: [] }]))
  const hasRealGeneral = activeGroups.some(group => normalizedName(group.nome) === 'geral')
  const legacy = {
    id: 'legacy-general',
    nome: hasRealGeneral ? 'Geral (sem grupo)' : 'Geral',
    ordem: Number.MAX_SAFE_INTEGER,
    ativo: true,
    virtual: true,
    titles: [],
  }

  for (const title of titles || []) {
    if (!title.ativo) continue
    const target = title.group_id ? indexed.get(title.group_id) : legacy
    if (!target) continue
    target.titles.push({ ...title, preview_url: previewForTitle(title) })
  }

  const ordered = [...indexed.values()]
  if (legacy.titles.length) ordered.push(legacy)
  return ordered
    .map(group => ({ ...group, titles: group.titles.sort(compareByOrderAndName) }))
    .sort(compareByOrderAndName)
}

export function filterVisualTitleGroups(groups, contentType, query = '') {
  const needle = normalizedName(query)
  return (groups || []).reduce((result, group) => {
    const groupMatches = normalizedName(group.nome).includes(needle)
    const titles = group.titles.filter(title => isVisualTitleCompatible(title, contentType) && (groupMatches || normalizedName(title.nome).includes(needle)))
    if (titles.length) result.push({ ...group, titles })
    return result
  }, [])
}

export function flattenVisualTitleGroups(groups) {
  return (groups || []).flatMap(group => group.titles)
}

// The visual title is the operator-facing editorial classification. The
// renderer still stores it in the legacy context_tag field, so derive that
// implementation detail from the selected seal instead of asking for a
// second, competing manual value.
export function editorialTagFromVisualTitleId(titles, selectedId, fallback = 'DESTAQUE') {
  const selected = (titles || []).find(title => title.id === selectedId)
  const name = String(selected?.nome || '').trim()
  return name ? name.toLocaleUpperCase('pt-BR') : fallback
}

export function retainCompatibleVisualTitleId(groups, selectedId, contentType) {
  if (!selectedId) return null
  const selected = flattenVisualTitleGroups(groups).find(title => title.id === selectedId)
  return selected && isVisualTitleCompatible(selected, contentType) ? selectedId : null
}

export function moveComboboxActiveIndex(currentIndex, direction, optionCount) {
  if (!optionCount) return -1
  if (direction === 'next') return Math.min(Math.max(currentIndex, -1) + 1, optionCount - 1)
  return Math.max(currentIndex - 1, 0)
}

export function makeVisualTitlePreview(supabase, title) {
  return assetPreviewUrl(supabase, { bucket: title.asset_bucket, path: title.asset_path })
}

export async function loadVisualTitleCatalog(supabase, clienteId) {
  if (!clienteId) throw new Error('Cliente operacional indisponível.')
  const [groupsResult, titlesResult] = await Promise.all([
    supabase.schema('ap').from('visual_title_groups').select('id,cliente_id,nome,ordem,ativo').eq('cliente_id', clienteId).eq('ativo', true).order('ordem', { ascending: true }).order('nome', { ascending: true }),
    supabase.schema('ap').from('visual_titles').select('id,cliente_id,group_id,nome,formatos,ordem,ativo,asset_bucket,asset_path,asset_version,sha256').eq('cliente_id', clienteId).eq('ativo', true).order('ordem', { ascending: true }).order('nome', { ascending: true }),
  ])
  if (groupsResult.error || titlesResult.error) throw new Error('Não foi possível carregar os selos da matéria.')
  return prepareVisualTitleCatalog(groupsResult.data, titlesResult.data, title => makeVisualTitlePreview(supabase, title))
}
