import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, Plus, Search } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { assetPreviewUrl } from '../../services/masterV1Assets'
import {
  formatBytes,
  normalizeSeloPng,
  PngValidationError,
  VALIDATION_MESSAGES,
} from '../../services/seloPngNormalizer'
import {
  createRenderSponsor,
  listRenderSponsors,
  setRenderSponsorActive,
  updateRenderSponsor,
} from '../../services/renderSponsors'

// A sponsor is three fields: name, PNG and availability. Format, order and
// rotation scope are decided by the database when the sponsor is registered.
const emptySponsor = { nome: '', ativo: true }

const PROCESSING_LABEL = {
  analyzing: 'Analisando imagem…',
  optimizing: 'Otimizando PNG…',
  ready: 'Imagem pronta para envio.',
}

function StatusChip({ ativo }) {
  return <span className={`ap-chip ${ativo ? 'tone-success' : 'tone-neutral'}`}>{ativo ? 'Ativo' : 'Inativo'}</span>
}

// Normalizes the PNG in the browser (validate → resize → optimize) and only
// hands the FINAL file to the parent, which is what gets uploaded and hashed.
function SponsorPngDrop({ asset, onChange, onProcessingChange, disabled }) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [meta, setMeta] = useState(null)
  const [localPreview, setLocalPreview] = useState(null)
  const tokenRef = useRef(0)

  const preview = localPreview || assetPreviewUrl(supabase, asset)
  const processing = status === 'analyzing' || status === 'optimizing'

  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview) }, [localPreview])

  async function choose(candidate) {
    if (!candidate) return
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
      if (tokenRef.current !== token) return
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
    Logo do patrocinador (PNG)
    <span
      className={`ap-dropzone${dragging ? ' dragging' : ''}`}
      tabIndex={0}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.currentTarget.querySelector('input')?.click() }}
      onDragOver={event => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files?.[0]) }}
    >
      <input type="file" accept="image/png" disabled={disabled || processing} onChange={event => choose(event.target.files?.[0])} style={{ display: 'none' }} />
      {preview ? <img className="ap-vt-preview" src={preview} alt="Prévia do logo" /> : <span className="ap-dropzone-icon"><ImagePlus size={20} aria-hidden="true" /></span>}
      <span className="ap-dropzone-label">Arraste o arquivo aqui ou clique para escolher</span>
      <small className="ap-dropzone-sub">PNG com fundo transparente. Imagens grandes são otimizadas automaticamente.</small>
    </span>
    {status && <p role="status" className="ap-config-intro">{PROCESSING_LABEL[status]}</p>}
    {meta && <dl className="ap-vt-optim">
      <div><dt>Original</dt><dd>{meta.original.width} × {meta.original.height} px · {formatBytes(meta.original.bytes)}</dd></div>
      <div><dt>Otimizado</dt><dd>{meta.final.width} × {meta.final.height} px · {formatBytes(meta.final.bytes)}</dd></div>
    </dl>}
    {error && <p role="alert" className="ap-vt-alert">{error}</p>}
  </label>
}

export default function SponsorsManager({ clienteId }) {
  const [sponsors, setSponsors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState(null)
  const [file, setFile] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [saving, setSaving] = useState(false)
  const [processingImage, setProcessingImage] = useState(false)

  const load = useCallback(async () => {
    if (!clienteId) { setLoading(false); setError('Nenhum cliente operacional autorizado foi encontrado.'); return }
    setLoading(true); setError('')
    try {
      setSponsors(await listRenderSponsors(supabase, clienteId))
    } catch (loadError) {
      setError(loadError.message || 'Não foi possível carregar os patrocinadores.')
    } finally { setLoading(false) }
  }, [clienteId])

  useEffect(() => { load() }, [load])

  const visible = useMemo(() => sponsors.filter(item => {
    const matchesSearch = item.nome.toLowerCase().includes(query.toLowerCase())
    const matchesStatus = filter === 'all' || (filter === 'active' ? item.ativo : !item.ativo)
    return matchesSearch && matchesStatus
  }), [sponsors, filter, query])

  async function save() {
    setSaving(true); setError(''); setNotice('')
    try {
      if (!form.nome.trim()) throw new Error('Informe o nome do patrocinador.')
      if (!form.id && !file) throw new Error('Envie o PNG do patrocinador.')
      if (form.id) {
        await updateRenderSponsor(supabase, clienteId, form.id, { nome: form.nome, file, ativo: form.ativo })
        setNotice('Alterações salvas.')
      } else {
        // One transactional call registers the sponsor and makes it eligible in
        // Feed and Reels; the operator does nothing else.
        await createRenderSponsor(supabase, clienteId, { nome: form.nome, file, ativo: form.ativo })
        setNotice('Patrocinador cadastrado e já disponível para a rotação.')
      }
      setForm(null); setFile(null); setProcessingImage(false)
      await load()
    } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }

  async function toggleActive(item) {
    setSaving(true); setError(''); setNotice('')
    try {
      await setRenderSponsorActive(supabase, clienteId, item.id, !item.ativo)
      setNotice(item.ativo
        ? 'Patrocinador desativado. Ele sai da rotação e mantém a posição para quando voltar.'
        : 'Patrocinador reativado na posição anterior.')
      await load()
    } catch (toggleError) { setError(toggleError.message) } finally { setSaving(false) }
  }

  if (loading) return <p role="status">Carregando patrocinadores...</p>

  return <section className="ap-form-section">
    <div className="ap-vt-header">
      <div>
        <h2 className="ap-form-card-title">Patrocinadores</h2>
        <p className="ap-config-intro">
          Cadastre o nome e o logo. O patrocinador entra automaticamente na
          rotação de Feed e Reels enquanto estiver ativo.
        </p>
      </div>
      <button type="button" className="ap-btn-add" onClick={() => { setForm({ ...emptySponsor }); setFile(null); setProcessingImage(false) }}>
        <Plus size={16} /> Novo patrocinador
      </button>
    </div>

    {form && <div className="ap-vt-dialog" role="dialog" aria-modal="true" aria-label={form.id ? 'Editar patrocinador' : 'Novo patrocinador'}>
      <form onSubmit={event => { event.preventDefault(); save() }} className="ap-form-card">
        <h3 className="ap-form-card-title">{form.id ? 'Editar patrocinador' : 'Novo patrocinador'}</h3>
        <label className="ap-field-label">
          Nome do patrocinador
          <input className="ap-input" required placeholder="Ex.: Clínica Vida" value={form.nome} onChange={event => setForm({ ...form, nome: event.target.value })} />
        </label>
        <SponsorPngDrop
          asset={form.id ? { bucket: form.asset_bucket, path: form.asset_path } : null}
          onChange={setFile}
          onProcessingChange={setProcessingImage}
          disabled={saving}
        />
        {form.id && <small className="ap-dropzone-sub">Enviar um novo PNG substitui o logo nas próximas matérias. As matérias já geradas continuam com a imagem original.</small>}
        <label className="ap-switch">
          <input type="checkbox" checked={form.ativo} onChange={event => setForm({ ...form, ativo: event.target.checked })} />
          <span className="ap-switch-track" />
          <span className="ap-switch-body"><span className="ap-switch-label">Disponível para a rotação</span></span>
        </label>
        <div className="ap-vt-actions">
          <button className="ap-btn-add" disabled={saving || processingImage}>{form.id ? 'Salvar alterações' : 'Cadastrar patrocinador'}</button>
          <button type="button" className="ap-btn-outline" onClick={() => { setForm(null); setFile(null); setProcessingImage(false) }}>Cancelar</button>
        </div>
      </form>
    </div>}

    <div className="ap-vt-toolbar">
      <div className="ap-vt-search"><Search size={16} /><input className="ap-input" placeholder="Buscar patrocinador" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <select className="ap-select" value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">Todos</option>
        <option value="active">Ativos</option>
        <option value="inactive">Inativos</option>
      </select>
    </div>

    {!visible.length ? <div className="ap-vt-empty">
      <p>Nenhum patrocinador cadastrado.</p>
      <small>Cadastre o primeiro patrocinador para que ele entre na rotação das matérias.</small>
    </div> : <div className="ap-table-container">
      <table className="ap-table">
        <thead><tr><th>Logo</th><th>Patrocinador</th><th>Status</th><th>Opções</th></tr></thead>
        <tbody>
          {visible.map(item => <tr key={item.id}>
            <td><img className="ap-vt-thumb" src={assetPreviewUrl(supabase, { bucket: item.asset_bucket, path: item.asset_path })} alt={`Logo de ${item.nome}`} /></td>
            <td>{item.nome}</td>
            <td><StatusChip ativo={item.ativo} /></td>
            <td><div className="ap-vt-actions">
              <button className="ap-btn-sm" onClick={() => { setForm({ ...item }); setFile(null); setProcessingImage(false) }}>Editar</button>
              <button className="ap-btn-sm" disabled={saving} onClick={() => toggleActive(item)}>{item.ativo ? 'Desativar' : 'Ativar'}</button>
            </div></td>
          </tr>)}
        </tbody>
      </table>
    </div>}

    {error && <p role="alert" className="ap-vt-alert">{error}</p>}
    {notice && <p role="status" className="ap-config-intro">{notice}</p>}
  </section>
}
