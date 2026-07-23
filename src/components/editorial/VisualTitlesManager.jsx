import { useCallback, useEffect, useRef, useState } from 'react'
import { assetPreviewUrl, slugify, uploadImmutablePng, validatePng } from '../../services/masterV1Assets'
import { supabase } from '../../services/supabase'
import { toast } from 'sonner'
import { UploadCloud, CheckCircle2 } from 'lucide-react'

const EMPTY_FORM = { nome: '', formatos: ['feed', 'reels'], ordem: 0, ativo: true }

function formatsLabel(formatos) {
  return formatos.map(format => (format === 'feed' ? 'Feed' : 'Reels')).join(', ')
}

export default function VisualTitlesManager({ clienteId, onChanged }) {
  const inputRef = useRef(null)
  const [titles, setTitles] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [editing, setEditing] = useState(null)
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)

  const loadTitles = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .schema('ap')
      .from('visual_titles')
      .select('*')
      .eq('cliente_id', clienteId)
      .order('ordem', { ascending: true })
      .order('nome', { ascending: true })

    if (error) toast.error(error.message)
    else setTitles(data || [])
    setLoading(false)
  }, [clienteId])

  useEffect(() => { loadTitles() }, [loadTitles])

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return undefined
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function resetForm() {
    setForm(EMPTY_FORM)
    setEditing(null)
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function setFormats(format, checked) {
    setForm(current => ({
      ...current,
      formatos: checked
        ? [...new Set([...current.formatos, format])]
        : current.formatos.filter(item => item !== format),
    }))
  }

  function chooseFile(nextFile) {
    try {
      validatePng(nextFile)
      setFile(nextFile)
    } catch (error) {
      toast.error(error.message)
    }
  }

  function onDrop(event) {
    event.preventDefault()
    setDragging(false)
    chooseFile(event.dataTransfer.files?.[0])
  }

  function beginEdit(item) {
    setEditing(item)
    setForm({ nome: item.nome, formatos: item.formatos, ordem: item.ordem, ativo: item.ativo })
    setFile(null)
    window.scrollTo?.({ top: 0, behavior: 'smooth' })
  }

  async function saveTitle(event) {
    event.preventDefault()
    const nome = form.nome.trim()
    const slug = slugify(nome)

    if (!nome) return toast.error('Informe como o selo será chamado.')
    if (!form.formatos.length) return toast.error('Escolha Feed, Reels ou ambos.')
    if (!editing && !file) return toast.error('Adicione a imagem PNG do selo.')

    setSaving(true)
    try {
      let asset = editing
        ? {
            bucket: editing.asset_bucket,
            path: editing.asset_path,
            version: editing.asset_version,
            sha256: editing.sha256,
          }
        : null

      if (file) {
        asset = await uploadImmutablePng({
          supabase,
          file,
          clienteId,
          kind: 'visual-titles',
          slug: editing?.slug || slug,
        })
      }

      const payload = {
        cliente_id: clienteId,
        nome,
        slug: editing?.slug || slug,
        asset_bucket: asset.bucket,
        asset_path: asset.path,
        asset_version: asset.version,
        sha256: asset.sha256,
        formatos: form.formatos,
        ativo: form.ativo,
        ordem: Number(form.ordem) || 0,
      }

      const query = editing
        ? supabase.schema('ap').from('visual_titles').update(payload).eq('id', editing.id).eq('cliente_id', clienteId)
        : supabase.schema('ap').from('visual_titles').insert(payload)
      const { error } = await query
      if (error) throw error

      resetForm()
      await loadTitles()
      onChanged?.()
      toast.success(editing ? 'Alterações salvas.' : 'Selo cadastrado.')
    } catch (error) {
      toast.error(error.message || 'Não foi possível salvar o selo. O arquivo anterior foi preservado.')
    } finally {
      setSaving(false)
    }
  }

  async function setActive(item, ativo) {
    const { error } = await supabase
      .schema('ap')
      .from('visual_titles')
      .update({ ativo })
      .eq('id', item.id)
      .eq('cliente_id', clienteId)
    if (error) toast.error(error.message)
    else {
      await loadTitles()
      onChanged?.()
    }
  }

  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <div>
        <h3 className="ap-form-card-title">Selos da matéria</h3>
        <p className="ap-config-intro" style={{ margin: '6px 0 0' }}>Cadastre uma vez os selos que identificam cada tipo de conteúdo. Depois, basta escolhê-los ao criar uma matéria.</p>
      </div>

      <form onSubmit={saveTitle} className="ap-form-card">
        <div className="ap-field-grid">
          <label className="ap-field-label">
            Como este selo será chamado?
            <input className="ap-input" value={form.nome} placeholder="Ex.: Esporte, Urgente ou Política" onChange={event => setForm(current => ({ ...current, nome: event.target.value }))} />
          </label>
          <label className="ap-field-label">
            Ordem de exibição
            <input className="ap-input" type="number" min="0" value={form.ordem} onChange={event => setForm(current => ({ ...current, ordem: event.target.value }))} />
            <small>Define a posição em que o selo aparecerá na lista.</small>
          </label>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <strong style={{ fontSize: 13, color: 'var(--color-text-primary)' }}>Onde este selo poderá ser usado?</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <label className="ap-switch">
              <input type="checkbox" checked={form.formatos.includes('feed')} onChange={event => setFormats('feed', event.target.checked)} />
              <span className="ap-switch-track" />
              <span className="ap-switch-label">Feed</span>
            </label>
            <label className="ap-switch">
              <input type="checkbox" checked={form.formatos.includes('reels')} onChange={event => setFormats('reels', event.target.checked)} />
              <span className="ap-switch-track" />
              <span className="ap-switch-label">Reels</span>
            </label>
          </div>
        </div>

        <label className="ap-switch">
          <input type="checkbox" checked={form.ativo} onChange={event => setForm(current => ({ ...current, ativo: event.target.checked }))} />
          <span className="ap-switch-track" />
          <span className="ap-switch-body">
            <span className="ap-switch-label">Selo disponível para uso</span>
            <span className="ap-switch-hint">Selos indisponíveis não aparecem na criação de matérias.</span>
          </span>
        </label>

        <div
          role="button"
          tabIndex={0}
          className={`ap-dropzone${dragging ? ' dragging' : ''}`}
          onClick={() => inputRef.current?.click()}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click() }}
          onDragEnter={event => { event.preventDefault(); setDragging(true) }}
          onDragOver={event => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {file ? (
            <div className="ap-dropzone-file"><CheckCircle2 size={16} /> {file.name}</div>
          ) : (
            <>
              <div className="ap-dropzone-icon"><UploadCloud size={18} /></div>
              <span className="ap-dropzone-label">Adicione a imagem do selo — clique ou arraste</span>
            </>
          )}
          <small style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>PNG de até 5 MB, preferencialmente com fundo transparente.</small>
          <input ref={inputRef} type="file" accept="image/png,.png" hidden onChange={event => chooseFile(event.target.files?.[0])} />
        </div>

        {(previewUrl || editing) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <img src={previewUrl || assetPreviewUrl(supabase, { bucket: editing.asset_bucket, path: editing.asset_path })} alt="Imagem do selo da matéria" className="ap-vt-preview" />
            {editing && !file && <span style={{ color: 'var(--color-text-tertiary)', fontSize: 13 }}>Adicione uma nova imagem PNG para criar outra versão.</span>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="ap-btn-add" disabled={saving}>{saving ? 'Enviando PNG...' : editing ? 'Salvar alterações' : 'Cadastrar selo'}</button>
          {editing && <button type="button" className="ap-btn-outline" onClick={resetForm} disabled={saving}>Cancelar edição</button>}
        </div>
      </form>

      <div className="ap-table-container">
        <table className="ap-table">
          <thead><tr><th>Imagem</th><th>Selo</th><th>Usado em</th><th>Posição</th><th>Disponibilidade</th><th>Opções</th></tr></thead>
          <tbody>
            {!loading && titles.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--color-text-tertiary)' }}><div>Você ainda não cadastrou nenhum selo.</div><small style={{ display: 'block', marginTop: 6 }}>Cadastre o primeiro selo para que ele apareça na criação de matérias.</small></td></tr>}
            {loading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--color-text-tertiary)' }}>Carregando selos…</td></tr>}
            {titles.map(item => <tr key={item.id}>
              <td><img src={assetPreviewUrl(supabase, { bucket: item.asset_bucket, path: item.asset_path })} alt={`Preview de ${item.nome}`} className="ap-vt-thumb" /></td>
              <td className="ap-td-title" style={{ fontWeight: 600 }}>{item.nome}</td>
              <td>{formatsLabel(item.formatos)}</td>
              <td>{item.ordem}</td>
              <td><span className={`ap-chip no-dot ${item.ativo ? 'tone-success' : 'tone-neutral'}`}>{item.ativo ? 'Ativo' : 'Arquivado'}</span></td>
              <td style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="ap-btn-sm" onClick={() => beginEdit(item)}>Editar</button>
                <button type="button" className="ap-btn-sm" onClick={() => setActive(item, !item.ativo)}>{item.ativo ? 'Desativar' : 'Ativar'}</button>
                {item.ativo && <button type="button" className="ap-btn-sm" onClick={() => setActive(item, false)}>Arquivar</button>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  )
}
