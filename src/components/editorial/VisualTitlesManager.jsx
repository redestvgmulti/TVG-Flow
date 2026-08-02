import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, Edit3, FolderOpen, ImagePlus, Plus, Search } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { assetPreviewUrl, uploadImmutablePng } from '../../services/masterV1Assets'
import {
  formatBytes,
  normalizeSeloPng,
  PngValidationError,
  VALIDATION_MESSAGES,
} from '../../services/seloPngNormalizer'
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
const FORMAT_LABELS = { feed: 'Feed', reels: 'Reels', story: 'Story' }

function formatLabels(formats) {
  return formats.map(format => FORMAT_LABELS[format] || format).join(', ')
}

function StatusChip({ ativo }) {
  return <span className={`ap-chip ${ativo ? 'tone-success' : 'tone-neutral'}`}>{ativo ? 'Disponível' : 'Arquivado'}</span>
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

const PROCESSING_LABEL = {
  analyzing: 'Analisando imagem…',
  optimizing: 'Otimizando PNG…',
  ready: 'Imagem pronta para envio.',
}

// Upload area for a selo PNG. On selection it normalizes the file in the browser
// (validate → resize → optimize) and only surfaces the FINAL PNG to the parent,
// which is what gets uploaded and hashed. Shows original vs. optimized details.
function PngDrop({ asset, onChange, onProcessingChange, disabled }) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('') // '' | analyzing | optimizing | ready
  const [meta, setMeta] = useState(null) // { original, final }
  const [localPreview, setLocalPreview] = useState(null)
  const tokenRef = useRef(0)

  const preview = localPreview || assetPreviewUrl(supabase, asset)
  const processing = status === 'analyzing' || status === 'optimizing'

  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview) }, [localPreview])

  async function choose(candidate) {
    if (!candidate) return
    // Selecting a new file clears every previous result before starting.
    const token = ++tokenRef.current
    setError('')
    setMeta(null)
    setLocalPreview(previous => { if (previous) URL.revokeObjectURL(previous); return null })
    onChange(null)
    setStatus('analyzing')
    onProcessingChange?.(true)
    try {
      const result = await normalizeSeloPng(candidate, {
        onState: value => { if (tokenRef.current === token) setStatus(value) },
      })
      if (tokenRef.current !== token) return // a newer selection superseded this one
      setLocalPreview(URL.createObjectURL(result.file))
      setMeta({ original: result.original, final: result.final })
      setStatus('ready')
      onChange(result.file)
    } catch (err) {
      if (tokenRef.current !== token) return
      const message = err instanceof PngValidationError
        ? (VALIDATION_MESSAGES[err.code] || err.message)
        : (err?.message || VALIDATION_MESSAGES.CORRUPTED)
      setError(message)
      setStatus('')
      setMeta(null)
      onChange(null)
    } finally {
      if (tokenRef.current === token) onProcessingChange?.(false)
    }
  }

  return <label className="ap-field-label">
    Adicione a imagem do selo
    <span
      className={`ap-dropzone${dragging ? ' dragging' : ''}`}
      tabIndex={0}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.currentTarget.querySelector('input')?.click() }}
      onDragOver={event => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files?.[0]) }}
    >
      <input type="file" accept="image/png" disabled={disabled || processing} onChange={event => choose(event.target.files?.[0])} style={{ display: 'none' }} />
      {preview ? <img className="ap-vt-preview" src={preview} alt="Prévia do selo" /> : <span className="ap-dropzone-icon"><ImagePlus size={20} aria-hidden="true" /></span>}
      <span className="ap-dropzone-label">Arraste o arquivo aqui ou clique para escolher</span>
      <small className="ap-dropzone-sub">PNG com fundo transparente. Recomendado: 1230 × 464 px. Imagens grandes são otimizadas automaticamente.</small>
    </span>
    {status && <p role="status" className="ap-config-intro">{PROCESSING_LABEL[status]}</p>}
    {meta && <dl className="ap-vt-optim">
      <div><dt>Original</dt><dd>{meta.original.width} × {meta.original.height} px · {formatBytes(meta.original.bytes)}</dd></div>
      <div><dt>Otimizado</dt><dd>{meta.final.width} × {meta.final.height} px · {formatBytes(meta.final.bytes)}</dd></div>
    </dl>}
    {error && <p role="alert" className="ap-vt-alert">{error}</p>}
  </label>
}

function GroupForm({ value, saving, onChange, onSave, onCancel }) {
  return <form onSubmit={event => { event.preventDefault(); onSave() }} className="ap-form-card">
    <label className="ap-field-label">Nome do grupo<input className="ap-input" required placeholder="Ex.: Cidades" value={value.nome} onChange={event => onChange({ ...value, nome: event.target.value })} /></label>
    <label className="ap-field-label">Descrição<textarea className="ap-input" placeholder="Ex.: Selos das cidades atendidas pelo portal" value={value.descricao || ''} onChange={event => onChange({ ...value, descricao: event.target.value })} /></label>
    <label className="ap-field-label">Ordem de exibição<input className="ap-input" type="number" min="0" value={value.ordem} onChange={event => onChange({ ...value, ordem: event.target.value })} /><small className="ap-dropzone-sub">Define a posição deste grupo na lista.</small></label>
    <label className="ap-switch">
      <input type="checkbox" checked={value.ativo} onChange={event => onChange({ ...value, ativo: event.target.checked })} />
      <span className="ap-switch-track" />
      <span className="ap-switch-body"><span className="ap-switch-label">Grupo disponível para uso</span></span>
    </label>
    <div className="ap-vt-actions"><button className="ap-btn-add" disabled={saving}>{value.id ? 'Salvar alterações' : 'Criar grupo'}</button><button type="button" className="ap-btn-outline" onClick={onCancel}>Cancelar</button></div>
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
  const [processingImage, setProcessingImage] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(null)

  const load = useCallback(async () => {
    if (!clienteId) { setLoading(false); setError('Nenhum cliente operacional autorizado foi encontrado.'); return }
    setLoading(true); setError('')
    try {
      const [nextGroups, nextTitles] = await Promise.all([listVisualTitleGroups(supabase, clienteId), listVisualTitles(supabase, clienteId)])
      setGroups(nextGroups); setTitles(nextTitles)
    } catch (loadError) {
      setError(loadError.message || 'Não foi possível carregar os selos da matéria. Tente novamente.')
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
    const matchesFilter = titleFilter === 'all' || (['feed', 'reels', 'story'].includes(titleFilter) ? title.formatos.includes(titleFilter) : titleFilter === 'active' ? title.ativo : !title.ativo)
    return matchesSearch && matchesFilter
  }).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR')), [selectedGroup, titleFilter, titleQuery])

  async function saveGroup() {
    setSaving(true); setError('')
    try {
      if (groupForm.id) await updateVisualTitleGroup(supabase, clienteId, groupForm.id, groupForm)
      else await createVisualTitleGroup(supabase, clienteId, groupForm)
      setNotice(groupForm.id ? 'Alterações salvas.' : 'Grupo criado com sucesso.')
      setGroupForm(null); await load(); onChanged?.()
    } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }

  async function saveTitle() {
    setSaving(true); setError('')
    try {
      if (!titleForm.group_id) throw new Error('Escolha um grupo antes de cadastrar o selo.')
      if (!titleForm.nome.trim()) throw new Error('Informe como este selo será chamado.')
      if (!titleForm.formatos.length) throw new Error('Escolha ao menos um formato.')
      if (!titleForm.id && !titleFile) throw new Error('Adicione a imagem PNG do selo.')
      const slug = slugifyVisualTitleGroup(titleForm.nome)
      let asset = null
      if (titleFile) asset = await uploadImmutablePng({ supabase, file: titleFile, clienteId, kind: 'visual-titles', slug })
      const payload = { nome: titleForm.nome.trim(), slug, group_id: titleForm.group_id, formatos: titleForm.formatos, ordem: Number(titleForm.ordem) || 0, ativo: Boolean(titleForm.ativo) }
      if (asset) Object.assign(payload, { asset_bucket: asset.bucket, asset_path: asset.path, asset_version: asset.version, sha256: asset.sha256 })
      const moved = titleForm.id && titleForm.group_id !== titleForm.original_group_id
      if (titleForm.id) await updateVisualTitle(supabase, clienteId, titleForm.id, payload)
      else await createVisualTitle(supabase, clienteId, payload)
      setNotice(moved ? 'Selo movido para o grupo selecionado.' : titleForm.id ? 'Alterações salvas.' : 'Selo cadastrado com sucesso.')
      setTitleForm(null); setTitleFile(null); setProcessingImage(false); await load(); onChanged?.()
    } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }

  async function toggleArchive(item) {
    setSaving(true); setError('')
    try {
      if (item.type === 'group') item.ativo ? await archiveVisualTitleGroup(supabase, clienteId, item.id) : await reactivateVisualTitleGroup(supabase, clienteId, item.id)
      else item.ativo ? await archiveVisualTitle(supabase, clienteId, item.id) : await reactivateVisualTitle(supabase, clienteId, item.id)
      setNotice(item.ativo ? 'Item arquivado. Nenhum histórico ou PNG foi apagado.' : 'Item reativado.')
      setConfirmArchive(null); await load(); onChanged?.()
    } catch (archiveError) { setError(archiveError.message) } finally { setSaving(false) }
  }

  if (loading) return <p role="status">Carregando grupos de selos...</p>
  if (error && !groups.length && !titles.length) return <div className="ap-form-section"><p role="alert" className="ap-vt-alert">Não foi possível carregar os selos da matéria. Tente novamente.</p><button className="ap-btn-outline" onClick={load}>Tentar novamente</button></div>

  if (selectedGroup) return <section className="ap-form-section">
    <button type="button" className="ap-btn-outline" onClick={() => { setSelectedGroupId(null); setTitleForm(null) }}><ArrowLeft size={15} /> Selos da matéria</button>
    <p className="ap-vt-subtitle">Selos da matéria <ChevronRight size={13} /> {selectedGroup.nome}</p>
    <div className="ap-vt-header"><div><h2 className="ap-form-card-title">{selectedGroup.nome}</h2><p className="ap-config-intro">Cadastre e organize os selos deste grupo.</p></div><div className="ap-vt-actions">{!selectedGroup.virtual && <button type="button" className="ap-btn-outline" onClick={() => setGroupForm({ ...selectedGroup })}><Edit3 size={15} /> Editar grupo</button>}{!selectedGroup.virtual && <button type="button" className="ap-btn-outline" onClick={() => selectedGroup.ativo ? setConfirmArchive({ type: 'group', ...selectedGroup }) : toggleArchive({ type: 'group', ...selectedGroup })}>{selectedGroup.ativo ? 'Arquivar grupo' : 'Reativar grupo'}</button>}<button type="button" className="ap-btn-add" disabled={selectedGroup.virtual || !selectedGroup.ativo} onClick={() => { setTitleForm({ ...emptyTitle, group_id: selectedGroup.id }); setTitleFile(null); setProcessingImage(false) }}><Plus size={16} /> Novo selo</button></div></div>
    {!selectedGroup.ativo && !selectedGroup.virtual && <p role="status" className="ap-vt-alert">Este grupo está arquivado e não aparecerá nas novas seleções.</p>}
    {groupForm && <div className="ap-vt-dialog" role="dialog" aria-modal="true" aria-label="Editar grupo"><GroupForm value={groupForm} saving={saving} onChange={setGroupForm} onSave={saveGroup} onCancel={() => setGroupForm(null)} /></div>}
    {titleForm && <div className="ap-vt-dialog" role="dialog" aria-modal="true" aria-label={titleForm.id ? 'Editar selo' : 'Novo selo'}><form onSubmit={event => { event.preventDefault(); saveTitle() }} className="ap-form-card"><h3 className="ap-form-card-title">{titleForm.id ? 'Editar selo' : 'Novo selo'}</h3><label className="ap-field-label">Como este selo será chamado?<input className="ap-input" required placeholder="Ex.: Goiatuba" value={titleForm.nome} onChange={event => setTitleForm({ ...titleForm, nome: event.target.value })} /></label><label className="ap-field-label">Mover para outro grupo<select className="ap-select" value={titleForm.group_id} onChange={event => setTitleForm({ ...titleForm, group_id: event.target.value })}>{groups.map(group => <option key={group.id} value={group.id}>{group.nome}{group.ativo ? '' : ' (arquivado)'}</option>)}</select></label><label className="ap-field-label">Ordem de exibição<input className="ap-input" type="number" min="0" value={titleForm.ordem} onChange={event => setTitleForm({ ...titleForm, ordem: event.target.value })} /></label><fieldset className="ap-vt-fieldset"><legend>Onde este selo poderá ser usado?</legend><label className="ap-vt-check"><input type="checkbox" checked={titleForm.formatos.includes('feed')} onChange={() => setTitleForm(toggleFormat(titleForm, 'feed'))} /> Feed</label><label className="ap-vt-check"><input type="checkbox" checked={titleForm.formatos.includes('reels')} onChange={() => setTitleForm(toggleFormat(titleForm, 'reels'))} /> Reels</label><label className="ap-vt-check"><input type="checkbox" checked={titleForm.formatos.includes('story')} onChange={() => setTitleForm(toggleFormat(titleForm, 'story'))} /> Story</label></fieldset><label className="ap-switch"><input type="checkbox" checked={titleForm.ativo} onChange={event => setTitleForm({ ...titleForm, ativo: event.target.checked })} /><span className="ap-switch-track" /><span className="ap-switch-body"><span className="ap-switch-label">Selo disponível para uso</span></span></label><PngDrop asset={titleForm.id ? { bucket: titleForm.asset_bucket, path: titleForm.asset_path } : null} onChange={setTitleFile} onProcessingChange={setProcessingImage} disabled={saving} /><div className="ap-vt-actions"><button className="ap-btn-add" disabled={saving || processingImage}>{titleForm.id ? 'Salvar alterações' : 'Cadastrar selo'}</button><button type="button" className="ap-btn-outline" onClick={() => { setTitleForm(null); setTitleFile(null); setProcessingImage(false) }}>Cancelar</button></div></form></div>}
    <div className="ap-vt-toolbar"><div className="ap-vt-search"><Search size={16} /><input className="ap-input" placeholder="Buscar selo" value={titleQuery} onChange={event => setTitleQuery(event.target.value)} /></div><select className="ap-select" value={titleFilter} onChange={event => setTitleFilter(event.target.value)}><option value="all">Todos</option><option value="feed">Feed</option><option value="reels">Reels</option><option value="story">Story</option><option value="active">Disponíveis</option><option value="archived">Arquivados</option></select></div>
    {!visibleTitles.length ? <div className="ap-vt-empty"><p>Este grupo ainda não possui selos.</p><small>Cadastre o primeiro selo para que ele possa ser usado nas matérias.</small></div> : <div className="ap-table-container"><table className="ap-table"><thead><tr><th>Imagem</th><th>Selo</th><th>Usado em</th><th>Posição</th><th>Disponibilidade</th><th>Opções</th></tr></thead><tbody>{visibleTitles.map(title => <tr key={title.id}><td><img className="ap-vt-thumb" src={assetPreviewUrl(supabase, { bucket: title.asset_bucket, path: title.asset_path })} alt={`Prévia do selo ${title.nome}`} /></td><td>{title.nome}</td><td>{formatLabels(title.formatos)}</td><td>{title.ordem}</td><td><StatusChip ativo={title.ativo} /></td><td><div className="ap-vt-actions"><button className="ap-btn-sm" onClick={() => { setTitleForm({ ...title, original_group_id: title.group_id }); setTitleFile(null); setProcessingImage(false) }}>Editar</button><button className="ap-btn-sm" onClick={() => title.ativo ? setConfirmArchive({ type: 'title', ...title }) : toggleArchive({ type: 'title', ...title })}>{title.ativo ? 'Arquivar' : 'Reativar'}</button></div></td></tr>)}</tbody></table></div>}
    {error && <p role="alert" className="ap-vt-alert">{error}</p>}{notice && <p role="status" className="ap-config-intro">{notice}</p>}{confirmArchive && <div className="ap-vt-dialog" role="dialog" aria-modal="true" aria-label="Confirmar arquivamento"><div className="ap-form-card"><h3 className="ap-form-card-title">Arquivar este {confirmArchive.type === 'group' ? 'grupo' : 'selo'}?</h3><p className="ap-config-intro">{confirmArchive.type === 'group' ? 'Os selos continuarão salvos, mas o grupo deixará de aparecer em novas seleções.' : 'Este selo ficará indisponível para novas matérias, mas continuará preservado no histórico.'}</p><div className="ap-vt-actions"><button className="ap-btn-add" disabled={saving} onClick={() => toggleArchive(confirmArchive)}>{confirmArchive.type === 'group' ? 'Arquivar grupo' : 'Arquivar selo'}</button><button className="ap-btn-outline" onClick={() => setConfirmArchive(null)}>Cancelar</button></div></div></div>}
  </section>

  return <section className="ap-form-section"><div className="ap-vt-header"><div><h2 className="ap-form-card-title">Selos da matéria</h2><p className="ap-config-intro">Organize os selos em grupos para encontrá-los com facilidade ao criar uma matéria.</p></div><button type="button" className="ap-btn-add" onClick={() => setGroupForm({ ...emptyGroup })}><Plus size={16} /> Novo grupo</button></div>
    {groupForm && <div className="ap-vt-dialog" role="dialog" aria-modal="true" aria-label={groupForm.id ? 'Editar grupo' : 'Novo grupo'}><GroupForm value={groupForm} saving={saving} onChange={setGroupForm} onSave={saveGroup} onCancel={() => setGroupForm(null)} /></div>}
    <div className="ap-vt-toolbar"><div className="ap-vt-search"><Search size={16} /><input className="ap-input" placeholder="Buscar grupo" value={groupQuery} onChange={event => setGroupQuery(event.target.value)} /></div><select className="ap-select" value={groupFilter} onChange={event => setGroupFilter(event.target.value)}><option value="all">Todos</option><option value="active">Disponíveis</option><option value="archived">Arquivados</option></select></div>
    {!visibleGroups.length ? <div className="ap-vt-empty"><p>Você ainda não criou nenhum grupo.</p><small>Crie um grupo para organizar os selos das matérias, como Cidades, Esportes ou Eventos.</small><button className="ap-btn-add" onClick={() => setGroupForm({ ...emptyGroup })}><Plus size={16} /> Criar primeiro grupo</button></div> : <div className="ap-vt-grid">{visibleGroups.map(group => { const archived = group.titles.filter(title => !title.ativo).length; return <article key={group.id} className="ap-vt-card"><div className="ap-vt-card-head"><div><h3 className="ap-vt-card-title">{group.nome}</h3>{group.descricao && <p className="ap-vt-card-desc">{group.descricao}</p>}</div><StatusChip ativo={group.ativo} /></div><small className="ap-vt-card-meta">{titleCount(group.titles)}{archived ? ` · ${archived} arquivado${archived > 1 ? 's' : ''}` : ''} · Ordem {group.ordem}</small><div className="ap-vt-actions"><button className="ap-btn-add" onClick={() => setSelectedGroupId(group.id)}><FolderOpen size={15} /> Abrir</button>{!group.virtual && <><button className="ap-btn-sm" onClick={() => setGroupForm({ ...group })}>Editar</button><button className="ap-btn-sm" onClick={() => group.ativo ? setConfirmArchive({ type: 'group', ...group }) : toggleArchive({ type: 'group', ...group })}>{group.ativo ? 'Arquivar' : 'Reativar'}</button></>}</div></article> })}</div>}
    {error && <p role="alert" className="ap-vt-alert">{error}</p>}{notice && <p role="status" className="ap-config-intro">{notice}</p>}{confirmArchive && <div className="ap-vt-dialog" role="dialog" aria-modal="true" aria-label="Confirmar arquivamento"><div className="ap-form-card"><h3 className="ap-form-card-title">Arquivar este grupo?</h3><p className="ap-config-intro">Os selos continuarão salvos, mas o grupo deixará de aparecer em novas seleções.</p><div className="ap-vt-actions"><button className="ap-btn-add" disabled={saving} onClick={() => toggleArchive(confirmArchive)}>Arquivar grupo</button><button className="ap-btn-outline" onClick={() => setConfirmArchive(null)}>Cancelar</button></div></div></div>}
  </section>
}
