export function slugifyVisualTitleGroup(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export async function resolveOperationalClienteId(supabase) {
  const { data, error } = await supabase.rpc('get_agencia_cliente_id')
  if (error) throw new Error('Nao foi possivel identificar o cliente operacional autorizado.')
  if (!data) throw new Error('Nenhum cliente operacional autorizado foi encontrado.')
  return data
}

function scopedTable(supabase, table, clienteId) {
  if (!clienteId) throw new Error('Cliente operacional indisponivel.')
  return supabase.schema('ap').from(table).select('*').eq('cliente_id', clienteId)
}

function humanize(error, fallback) {
  if (error?.code === '23505') return 'Ja existe um grupo ou selo com este nome para o cliente.'
  if (/CITY_TITLE_MANAGED_BY_TERRITORIAL_RPC/.test(error?.message || '')) {
    return 'Este selo é gerenciado pelo cadastro da cidade. Edite-o na área de Regiões.'
  }
  if (error?.code === '42501') return 'Voce nao tem permissao para alterar estes selos.'
  return fallback
}

export async function listVisualTitleGroups(supabase, clienteId) {
  const { data, error } = await scopedTable(supabase, 'visual_title_groups', clienteId)
    .order('ordem', { ascending: true })
    .order('nome', { ascending: true })
  if (error) throw new Error(humanize(error, 'Nao foi possivel carregar os grupos de selos.'))
  return data || []
}

export async function listVisualTitles(supabase, clienteId) {
  const { data, error } = await scopedTable(supabase, 'visual_titles', clienteId)
    .order('ordem', { ascending: true })
    .order('nome', { ascending: true })
  if (error) throw new Error(humanize(error, 'Nao foi possivel carregar os selos da materia.'))
  return data || []
}

export async function createVisualTitleGroup(supabase, clienteId, input) {
  const slug = slugifyVisualTitleGroup(input.nome)
  if (!input.nome?.trim() || !slug) throw new Error('Informe o nome do grupo.')
  const { data, error } = await supabase.schema('ap').from('visual_title_groups').insert({
    cliente_id: clienteId,
    nome: input.nome.trim(),
    slug,
    descricao: input.descricao?.trim() || null,
    ordem: Number(input.ordem) || 0,
    ativo: Boolean(input.ativo),
  }).select().single()
  if (error) throw new Error(humanize(error, 'Nao foi possivel criar o grupo.'))
  return data
}

export async function updateVisualTitleGroup(supabase, clienteId, groupId, input) {
  const slug = slugifyVisualTitleGroup(input.nome)
  if (!input.nome?.trim() || !slug) throw new Error('Informe o nome do grupo.')
  const { data, error } = await supabase.schema('ap').from('visual_title_groups').update({
    nome: input.nome.trim(),
    slug,
    descricao: input.descricao?.trim() || null,
    ordem: Number(input.ordem) || 0,
    ativo: Boolean(input.ativo),
  }).eq('id', groupId).eq('cliente_id', clienteId).select().single()
  if (error) throw new Error(humanize(error, 'Nao foi possivel salvar o grupo.'))
  return data
}

export function archiveVisualTitleGroup(supabase, clienteId, groupId) {
  return updateGroupAvailability(supabase, clienteId, groupId, false)
}

export function reactivateVisualTitleGroup(supabase, clienteId, groupId) {
  return updateGroupAvailability(supabase, clienteId, groupId, true)
}

async function updateGroupAvailability(supabase, clienteId, groupId, ativo) {
  const { error } = await supabase.schema('ap').from('visual_title_groups').update({ ativo }).eq('id', groupId).eq('cliente_id', clienteId)
  if (error) throw new Error(humanize(error, 'Nao foi possivel atualizar a disponibilidade do grupo.'))
}

export async function createVisualTitle(supabase, clienteId, input) {
  if (!input.group_id) throw new Error('Escolha um grupo antes de cadastrar o selo.')
  const { data, error } = await supabase.schema('ap').from('visual_titles').insert({ ...input, cliente_id: clienteId }).select().single()
  if (error) throw new Error(humanize(error, 'Nao foi possivel cadastrar o selo.'))
  return data
}

export async function updateVisualTitle(supabase, clienteId, titleId, input) {
  const { data, error } = await supabase.schema('ap').from('visual_titles').update(input).eq('id', titleId).eq('cliente_id', clienteId).select().single()
  if (error) throw new Error(humanize(error, 'Nao foi possivel salvar o selo.'))
  return data
}

export function moveVisualTitle(supabase, clienteId, titleId, groupId) {
  if (!groupId) return Promise.reject(new Error('Escolha o grupo de destino.'))
  return updateVisualTitle(supabase, clienteId, titleId, { group_id: groupId })
}

export function archiveVisualTitle(supabase, clienteId, titleId) {
  return updateVisualTitle(supabase, clienteId, titleId, { ativo: false })
}

export function reactivateVisualTitle(supabase, clienteId, titleId) {
  return updateVisualTitle(supabase, clienteId, titleId, { ativo: true })
}

export function groupVisualTitles(groups, titles) {
  const indexed = new Map(groups.map(group => [group.id, { ...group, titles: [] }]))
  const legacy = { id: 'legacy-general', nome: 'Geral', descricao: 'Selos ainda nao organizados em um grupo.', ordem: Number.MAX_SAFE_INTEGER, ativo: true, virtual: true, titles: [] }
  for (const title of titles) {
    const target = title.group_id ? indexed.get(title.group_id) : legacy
    ;(target || legacy).titles.push(title)
  }
  const result = [...indexed.values()]
  if (legacy.titles.length) result.push(legacy)
  return result.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'))
}
