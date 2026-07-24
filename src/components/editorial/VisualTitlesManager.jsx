import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Edit3, FolderOpen, ImagePlus, Plus, Search } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { assetPreviewUrl, uploadImmutablePng } from '../../services/masterV1Assets'
import {
  archiveVisualTitle,
  archiveVisualTitleGroup,
  createVisualTitle,
  createVisualTitleGroup,
  groupVisualTitles,
  listVisualTitleGroups,
  listVisualTitles,
  reactivateVisualTitle,
  reactivateVisualTitleGroup,
  slugifyVisualTitleGroup,
  updateVisualTitle,
  updateVisualTitleGroup,
} from '../../services/visualTitleGroups'

const emptyGroup = { nome: '', descricao: '', ordem: 0, ativo: true }
const emptyTitle = { nome: '', formatos: ['feed', 'reels'], ordem: 0, ativo: true, group_id: '' }

function statusLabel(ativo) {
  return ativo ? 'Disponivel' : 'Arquivado'
}

function titleCount(titles) {
  if (!titles.length) return 'Nenhum selo'
  return `${titles.length} ${titles.length === 1 ? 'selo' : 'selos'}`
}

function toggleFormat(form, format) {
  const formatos = form.formatos.includes(format)
    ? form.formatos.filter(item => item !== format)
    : [...form.formatos, format]
  return { ...form, formatos }
}

function PngDrop({ file, asset, onChange, disabled }) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const preview = useMemo(() => file ? URL.createObjectURL(file) : assetPreviewUrl(supabase, asset), [asset, file])

  useEffect(() => () => {
    if (file && preview) URL.revokeObjectURL(preview)
  }, [file, preview])

  function choose(candidate) {
    if (!candidate) return
    if (candidate.type !== 'image/png' || !candidate.name.toLowerCase().endsWith('.png')) {
      setError('Envie somente arquivos PNG.')
      return
    }
    if (candidate.size > 5 * 1024 * 1024) {
      setError('Use uma imagem PNG de ate 5 MB.')
      return
    }
    setError('')
    onChange(candidate)
  }

  return <div>
    <label style={{ display: 'grid', gap: 8 }}>
      <strong>Adicione a imagem do selo</strong>
      <span
        tabIndex={0}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.currentTarget.querySelector('input')?.click() }}
        onDragOver={event => { event.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files?.[0]) }}
        style={{ border: `2px dashed ${dragging ? '#2563eb' : '#cbd5e1'}`, borderRadius: 12, minHeight: 120, padding: 16, cursor: disabled ? 'not-allowed' : 'pointer', display: 'grid', gap: 8, placeItems: 'center', background: dragging ? '#eff6ff' : '#f8fafc' }}
      >
        <input type="file" accept="image/png" disabled={disabled} onChange={event => choose(event.target.files?.[0])} style={{ display: 'none' }} />
        {preview ? <img src={preview} alt="Previa do selo" style={{ maxHeight: 90, maxWidth: '100%', objectFit: 'contain' }} /> : <ImagePlus size={30} aria-hidden="true" />}
        <span>Arraste o arquivo aqui ou clique para escolher</span>
        <small>Use uma imagem PNG de ate 5 MB, preferencialmente com fundo transparente.</small>
      </span>
    </label>
    {file && <small>{file.name}</small>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
  </div>
}

function GroupForm({ value, saving, onChange, onSave, onCancel }) {
  return <form onSubmit={event => { event.preventDefault(); onSave() }} style={{ display: 'grid', gap: 12 }}>
    <label>Nome do grupo<input className="ap-input" required placeholder="Ex.: Cidades" value={value.nome} onChange={event => onChange({ ...value, nome: event.target.value })} /></label>
    <label>Descricao<textarea className="ap-input" placeholder="Ex.: Selos das cidades atendidas pelo portal" value={value.descricao || ''} onChange={event => onChange({ ...value, descricao: event.target.value })} /></label>
    <label>Ordem de exibicao<input className="ap-input" type="number" min="0" value={value.ordem} onChange={event => onChange({ ...value, ordem: event.target.value })} /><small>Define a posicao deste grupo na lista.</small></label>
    <label><strong>Disponibilidade</strong><span><input type="checkbox" checked={value.ativo} onChange={event => onChange({ ...value, ativo: event.target.checked })} /> Grupo disponivel para uso</span></label>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="ap-btn-add" disabled={saving}>{value.id ? 'Salvar alteracoes' : 'Criar grupo'}</button><button type="button" className="ap-btn-outline" onClick={onCancel}>Cancelar</button></div>
  </form>
}

export default function VisualTitlesManager({ clienteId, onChanged }) {
  const [groups, setGroups] = useState([])
  const [titles, setTitles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [groupQuery, setGroupQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')
  const [selectedGroupId, setSelectedGroupId] = useState(null)
  const [groupForm, setGroupForm] = useState(null)
  const [titleForm, setTitleForm] = useState(null)
  const [titleFile, setTitleFile] = useState(null)
  const [titleQuery, setTitleQuery] = useState('')
  const [titleFilter, setTitleFilter] = useState('all')
  const [saving, setSaving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(null)

  const load = useCallback(async () => {
    if (!clienteId) { setLoading(false); setError('Nenhum cliente operacional autorizado foi encontrado.'); return }
    setLoading(true); setError('')
    try {
      const [nextGroups, nextTitles] = await Promise.all([listVisualTitleGroups(supabase, clienteId), listVisualTitles(supabase, clienteId)])
      setGroups(nextGroups); setTitles(nextTitles)
    } catch (loadError) {
      setError(loadError.message || 'Nao foi possivel carregar os selos da materia. Tente novamente.')
    } finally { setLoading(false) }
  }, [clienteId])

  useEffect(() => { load() }, [load])

  const grouped = useMemo(() => groupVisualTitles(groups, titles), [groups, titles])
  const selectedGroup = grouped.find(group => group.id === selectedGroupId) || null
  const visibleGroups = useMemo(() => grouped.filter(group => {
    const matchesSearch = `${group.nome} ${group.descricao || ''}`.toLowerCase().includes(groupQuery.toLowerCase())
    const matchesStatus = groupFilter === 'all' || (groupFilter === 'active' ? group.ativo : !group.ativo)
    return matchesSearch && matchesStatus
  }), [grouped, groupFilter, groupQuery])
  const visibleTitles = useMemo(() => (selectedGroup?.titles || []).filter(title => {
    const matchesSearch = title.nome.toLowerCase().includes(titleQuery.toLowerCase())
    const matchesFilter = titleFilter === 'all' || (titleFilter === 'feed' ? title.formatos.includes('feed') : titleFilter === 'reels' ? title.formatos.includes('reels') : titleFilter === 'active' ? title.ativo : !title.ativo)
    return matchesSearch && matchesFilter
  }).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR')), [selectedGroup, titleFilter, titleQuery])

  async function saveGroup() {
    setSaving(true); setError('')
    try {
      if (groupForm.id) await updateVisualTitleGroup(supabase, clienteId, groupForm.id, groupForm)
      else await createVisualTitleGroup(supabase, clienteId, groupForm)
      setNotice(groupForm.id ? 'Altera...?es salvas.' : 'Grupo criado com sucesso.')
      setGroupForm(null); await load(); onChanged?.()
    } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }

  async function saveTitle() {
    setSaving(true); setError('')
    try {
      if (!titleForm.group_id) throw new Error('Escolha um grupo antes de cadastrar o selo.')
      if (!titleForm.nome.trim()) throw new Error('Informe como este selo sera chamado.')
      if (!titleForm.formatos.length) throw new Error('Escolha Feed, Reels ou ambos.')
      if (!titleForm.id && !titleFile) throw new Error('Adicione a imagem PNG do selo.')
      const slug = slugifyVisualTitleGroup(titleForm.nome)
      let asset = null
      if (titleFile) asset = await uploadImmutablePng({ supabase, file: titleFile, clienteId, kind: 'visual-titles', slug })
      const payload = { nome: titleForm.nome.trim(), slug, group_id: titleForm.group_id, formatos: titleForm.formatos, ordem: Number(titleForm.ordem) || 0, ativo: Boolean(titleForm.ativo) }
      if (asset) Object.assign(payload, { asset_bucket: asset.bucket, asset_path: asset.path, asset_version: asset.version, sha256: asset.sha256 })
      const moved = titleForm.id && titleForm.group_id !== titleForm.original_group_id
      if (titleForm.id) await updateVisualTitle(supabase, clienteId, titleForm.id, payload)
      else await createVisualTitle(supabase, clienteId, payload)
      setNotice(moved ? 'Selo movido para o grupo selecionado.' : titleForm.id ? 'Altera...?es salvas.' : 'Selo cadastrado com sucesso.')
      setTitleForm(null); setTitleFile(null); await load(); onChanged?.()
    } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }

  async function toggleArchive(item) {
    setSaving(true); setError('')
    try {
      if (item.type === 'group') item.ativo ? await archiveVisualTitleGroup(supabase, clienteId, item.id) : await reactivateVisualTitleGroup(supabase, clienteId, item.id)
      else item.ativo ? await archiveVisualTitle(supabase, clienteId, item.id) : await reactivateVisualTitle(supabase, clienteId, item.id)
      setNotice(item.ativo ? 'Item arquivado. Nenhum historico ou PNG foi apagado.' : 'Item reativado.')
      setConfirmArchive(null); await load(); onChanged?.()
    } catch (archiveError) { setError(archiveError.message) } finally { setSaving(false) }
  }

  if (loading) return <p role="status">Carregando grupos de selos...</p>
  if (error && !groups.length && !titles.length) return <div><p role="alert">Nao foi possivel carregar os selos da materia. Tente novamente.</p><button className="ap-btn-outline" onClick={load}>Tentar novamente</button></div>

  if (selectedGroup) return <section className="ap-form-section">
    <button type="button" className="ap-btn-outline" onClick={() => { setSelectedGroupId(null); setTitleForm(null) }}><ArrowLeft size={15} /> Selos da materia</button>
    <p style={{ color: '#64748b', margin: '12px 0 4px' }}>Selos da materia ... {selectedGroup.nome}</p>
    <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}><div><h2>{selectedGroup.nome}</h2><p>Cadastre e organize os selos deste grupo.</p></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{!selectedGroup.virtual && <button type="button" className="ap-btn-outline" onClick={() => setGroupForm({ ...selectedGroup })}><Edit3 size={15} /> Editar grupo</button>}{!selectedGroup.virtual && <button type="button" className="ap-btn-outline" onClick={() => selectedGroup.ativo ? setConfirmArchive({ type: 'group', ...selectedGroup }) : toggleArchive({ type: 'group', ...selectedGroup })}>{selectedGroup.ativo ? 'Arquivar grupo' : 'Reativar grupo'}</button>}<button type="button" className="ap-btn-add" disabled={selectedGroup.virtual || !selectedGroup.ativo} onClick={() => { setTitleForm({ ...emptyTitle, group_id: selectedGroup.id }); setTitleFile(null) }}>Novo selo</button></div></div>
    {!selectedGroup.ativo && !selectedGroup.virtual && <p role="status" style={{ background: '#fff7ed', padding: 12, borderRadius: 8 }}>Este grupo esta arquivado e nao aparecera nas novas selecoes.</p>}
    {groupForm && <div role="dialog" aria-modal="true" aria-label="Editar grupo" style={{ background: '#f8fafc', padding: 16, borderRadius: 12, marginTop: 12 }}><GroupForm value={groupForm} saving={saving} onChange={setGroupForm} onSave={saveGroup} onCancel={() => setGroupForm(null)} /></div>}
    {titleForm && <div role="dialog" aria-modal="true" aria-label={titleForm.id ? 'Editar selo' : 'Novo selo'} style={{ background: '#f8fafc', padding: 16, borderRadius: 12, marginTop: 16 }}><h3>{titleForm.id ? 'Editar selo' : 'Novo selo'}</h3><form onSubmit={event => { event.preventDefault(); saveTitle() }} style={{ display: 'grid', gap: 12 }}><label>Como este selo sera chamado?<input className="ap-input" required placeholder="Ex.: Goiatuba" value={titleForm.nome} onChange={event => setTitleForm({ ...titleForm, nome: event.target.value })} /></label><label>Mover para outro grupo<select className="ap-select" value={titleForm.group_id} onChange={event => setTitleForm({ ...titleForm, group_id: event.target.value })}>{groups.map(group => <option key={group.id} value={group.id}>{group.nome}{group.ativo ? '' : ' (arquivado)'}</option>)}</select></label><label>Ordem de exibicao<input className="ap-input" type="number" min="0" value={titleForm.ordem} onChange={event => setTitleForm({ ...titleForm, ordem: event.target.value })} /></label><fieldset><legend>Onde este selo podera ser usado?</legend><label><input type="checkbox" checked={titleForm.formatos.includes('feed')} onChange={() => setTitleForm(toggleFormat(titleForm, 'feed'))} /> Feed</label><label><input type="checkbox" checked={titleForm.formatos.includes('reels')} onChange={() => setTitleForm(toggleFormat(titleForm, 'reels'))} /> Reels</label></fieldset><label><strong>Disponibilidade</strong><span><input type="checkbox" checked={titleForm.ativo} onChange={event => setTitleForm({ ...titleForm, ativo: event.target.checked })} /> Selo disponivel para uso</span></label><PngDrop file={titleFile} asset={titleForm.id ? { bucket: titleForm.asset_bucket, path: titleForm.asset_path } : null} onChange={setTitleFile} disabled={saving} /><div style={{ display: 'flex', gap: 8 }}><button className="ap-btn-add" disabled={saving}>{titleForm.id ? 'Salvar alteracoes' : 'Cadastrar selo'}</button><button type="button" className="ap-btn-outline" onClick={() => { setTitleForm(null); setTitleFile(null) }}>Cancelar</button></div></form></div>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}><label><Search size={14} /><input className="ap-input" placeholder="Buscar selo" value={titleQuery} onChange={event => setTitleQuery(event.target.value)} /></label><select className="ap-select" value={titleFilter} onChange={event => setTitleFilter(event.target.value)}><option value="all">Todos</option><option value="feed">Feed</option><option value="reels">Reels</option><option value="active">Disponiveis</option><option value="archived">Arquivados</option></select></div>
    {!visibleTitles.length ? <div style={{ padding: 24, textAlign: 'center' }}><p>Este grupo ainda nao possui selos.</p><small>Cadastre o primeiro selo para que ele possa ser usado nas materias.</small></div> : <div className="ap-table-container"><table className="ap-table"><thead><tr><th>Imagem</th><th>Selo</th><th>Usado em</th><th>Posicao</th><th>Disponibilidade</th><th>Opcoes</th></tr></thead><tbody>{visibleTitles.map(title => <tr key={title.id}><td><img src={assetPreviewUrl(supabase, { bucket: title.asset_bucket, path: title.asset_path })} alt={`Previa do selo ${title.nome}`} style={{ height: 36, maxWidth: 90, objectFit: 'contain' }} /></td><td>{title.nome}</td><td>{title.formatos.length === 2 ? 'Feed e Reels' : title.formatos.join(', ')}</td><td>{title.ordem}</td><td>{statusLabel(title.ativo)}</td><td><button className="ap-btn-sm" onClick={() => { setTitleForm({ ...title, original_group_id: title.group_id }); setTitleFile(null) }}>Editar</button><button className="ap-btn-sm" onClick={() => title.ativo ? setConfirmArchive({ type: 'title', ...title }) : toggleArchive({ type: 'title', ...title })}>{title.ativo ? 'Arquivar' : 'Reativar'}</button></td></tr>)}</tbody></table></div>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{confirmArchive && <div role="dialog" aria-modal="true" aria-label="Confirmar arquivamento" style={{ background: '#fff7ed', padding: 16, borderRadius: 12, marginTop: 16 }}><h3>Arquivar este {confirmArchive.type === 'group' ? 'grupo' : 'selo'}?</h3><p>{confirmArchive.type === 'group' ? 'Os selos continuarao salvos, mas o grupo deixara de aparecer em novas selecoes.' : 'Este selo ficara indisponivel para novas materias, mas continuara preservado no historico.'}</p><button className="ap-btn-add" disabled={saving} onClick={() => toggleArchive(confirmArchive)}>{confirmArchive.type === 'group' ? 'Arquivar grupo' : 'Arquivar selo'}</button><button className="ap-btn-outline" onClick={() => setConfirmArchive(null)}>Cancelar</button></div>}
  </section>

  return <section className="ap-form-section"><div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}><div><h2>Selos da materia</h2><p>Organize os selos em grupos para encontra-los com facilidade ao criar uma materia.</p></div><button type="button" className="ap-btn-add" onClick={() => setGroupForm({ ...emptyGroup })}><Plus size={16} /> Novo grupo</button></div>
    {groupForm && <div role="dialog" aria-modal="true" aria-label={groupForm.id ? 'Editar grupo' : 'Novo grupo'} style={{ background: '#f8fafc', padding: 16, borderRadius: 12, marginTop: 16 }}><GroupForm value={groupForm} saving={saving} onChange={setGroupForm} onSave={saveGroup} onCancel={() => setGroupForm(null)} /></div>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}><label><Search size={14} /><input className="ap-input" placeholder="Buscar grupo" value={groupQuery} onChange={event => setGroupQuery(event.target.value)} /></label><select className="ap-select" value={groupFilter} onChange={event => setGroupFilter(event.target.value)}><option value="all">Todos</option><option value="active">Disponiveis</option><option value="archived">Arquivados</option></select></div>
    {!visibleGroups.length ? <div style={{ padding: 28, textAlign: 'center' }}><p>Voce ainda nao criou nenhum grupo.</p><small>Crie um grupo para organizar os selos das materias, como Cidades, Esportes ou Eventos.</small><div style={{ marginTop: 12 }}><button className="ap-btn-add" onClick={() => setGroupForm({ ...emptyGroup })}>Criar primeiro grupo</button></div></div> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, marginTop: 16 }}>{visibleGroups.map(group => { const archived = group.titles.filter(title => !title.ativo).length; return <article key={group.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, display: 'grid', gap: 10 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div><h3 style={{ margin: 0 }}>{group.nome}</h3>{group.descricao && <p style={{ margin: '4px 0', color: '#64748b' }}>{group.descricao}</p>}</div><span>{statusLabel(group.ativo)}</span></div><small>{titleCount(group.titles)}{archived ? ` - ${archived} arquivado${archived > 1 ? 's' : ''}` : ''} - Ordem {group.ordem}</small><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="ap-btn-add" onClick={() => setSelectedGroupId(group.id)}><FolderOpen size={15} /> Abrir</button>{!group.virtual && <><button className="ap-btn-sm" onClick={() => setGroupForm({ ...group })}>Editar</button><button className="ap-btn-sm" onClick={() => group.ativo ? setConfirmArchive({ type: 'group', ...group }) : toggleArchive({ type: 'group', ...group })}>{group.ativo ? 'Arquivar' : 'Reativar'}</button></>}</div></article> })}</div>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{confirmArchive && <div role="dialog" aria-modal="true" aria-label="Confirmar arquivamento" style={{ background: '#fff7ed', padding: 16, borderRadius: 12, marginTop: 16 }}><h3>Arquivar este grupo?</h3><p>Os selos continuarao salvos, mas o grupo deixara de aparecer em novas selecoes.</p><button className="ap-btn-add" disabled={saving} onClick={() => toggleArchive(confirmArchive)}>Arquivar grupo</button><button className="ap-btn-outline" onClick={() => setConfirmArchive(null)}>Cancelar</button></div>}
  </section>
}
