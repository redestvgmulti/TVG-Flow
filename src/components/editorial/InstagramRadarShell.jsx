import { useCallback, useEffect, useMemo, useState } from 'react'
import { Instagram, Loader2, Pause, Play, Plus, Radar, Trash2, X } from 'lucide-react'
import { supabase } from '../../services/supabase'
import {
  createInstagramSource,
  listInstagramSources,
  normalizeInstagramProfile,
  removeInstagramSource,
  setInstagramSourceActive,
} from '../../services/instagramRadarService'
import { getMetaConnectionStatus } from '../../services/metaIntegration'

function formatDate(value, fallback) {
  if (!value) return fallback
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function errorMessage(error) {
  if (error?.code === 'INSTAGRAM_SOURCE_ALREADY_EXISTS') return 'Este perfil já está sendo monitorado.'
  if (error?.code === 'INSTAGRAM_SOURCE_INVALID') return 'Informe um @username ou URL válida de perfil do Instagram.'
  return 'Não foi possível atualizar os perfis monitorados. Tente novamente.'
}

export default function InstagramRadarShell({ onConnect, clienteId }) {
  const [status, setStatus] = useState(null)
  const [sources, setSources] = useState([])
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [input, setInput] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingId, setPendingId] = useState(null)
  const [operationError, setOperationError] = useState('')

  const loadStatus = useCallback(
    () => getMetaConnectionStatus(supabase, clienteId)
      .then(setStatus)
      .catch(() => setStatus({ connected: false })),
    [clienteId],
  )
  const loadSources = useCallback(async () => {
    if (!clienteId) return
    setSourcesLoading(true)
    setOperationError('')
    try {
      setSources(await listInstagramSources(supabase, clienteId))
    } catch (error) {
      setOperationError(errorMessage(error))
    } finally {
      setSourcesLoading(false)
    }
  }, [clienteId])

  useEffect(() => { void loadStatus() }, [loadStatus])
  useEffect(() => {
    if (status?.connected) void loadSources()
    else setSources([])
  }, [status?.connected, loadSources])

  const preview = useMemo(() => {
    if (!input.trim()) return null
    try { return normalizeInstagramProfile(input) } catch { return null }
  }, [input])

  async function addSource(event) {
    event.preventDefault()
    setFormError('')
    if (!preview) {
      setFormError('Informe um @username ou URL válida de perfil do Instagram.')
      return
    }
    setSaving(true)
    try {
      const source = await createInstagramSource(supabase, clienteId, input)
      setSources(current => [...current, source])
      setInput('')
      setModalOpen(false)
    } catch (error) {
      setFormError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function updateActive(source) {
    setPendingId(source.id)
    setOperationError('')
    try {
      const next = await setInstagramSourceActive(supabase, clienteId, source.id, !source.ativo)
      setSources(current => current.map(item => item.id === next.id ? next : item))
    } catch (error) {
      setOperationError(errorMessage(error))
    } finally {
      setPendingId(null)
    }
  }

  async function removeSource(source) {
    setPendingId(source.id)
    setOperationError('')
    try {
      const result = await removeInstagramSource(supabase, clienteId, source.id)
      setSources(current => result.deactivated
        ? current.map(item => item.id === source.id ? result.source : item)
        : current.filter(item => item.id !== source.id))
    } catch (error) {
      setOperationError(errorMessage(error))
    } finally {
      setPendingId(null)
    }
  }

  if (!status) return <div className="aps-card" role="status">Carregando Radar…</div>
  if (!status.connected) return <div className="aps-card aps-radar-empty">
    <Instagram size={32} color="#E1306C" /><h2>Conecte o Instagram para ativar o Radar.</h2>
    <p>O Radar começa somente depois que uma conta profissional Meta for conectada.</p>
    <button type="button" className="aps-btn aps-btn-primary" onClick={onConnect}>Conectar Instagram</button>
  </div>

  return <div className="aps-card no-pad">
    <div className="aps-card-head bordered">
      <div>
        <h2 className="aps-card-title"><Radar size={17} color="#E1306C" /> Radar Instagram</h2>
        <p className="aps-card-desc">Cadastre perfis profissionais para o próximo ciclo de descoberta oficial Meta.</p>
      </div>
    </div>
    <div className="aps-radar-columns">
      <section>
        <h3>Últimas publicações</h3>
        <p>Nenhuma publicação coletada ainda.</p>
      </section>
      <section>
        <div className="aps-radar-section-head">
          <div><h3>Perfis monitorados</h3><p>{sources.length} {sources.length === 1 ? 'perfil monitorado' : 'perfis monitorados'}</p></div>
          <button type="button" className="aps-btn aps-btn-outline" onClick={() => setModalOpen(true)}><Plus size={14} /> Adicionar perfil</button>
        </div>
        {operationError && <p role="alert" className="aps-radar-error">{operationError}</p>}
        {sourcesLoading ? <p role="status">Carregando perfis…</p> : sources.length === 0 ? <div className="aps-empty">
          <p className="aps-empty-title">Nenhum perfil monitorado ainda.</p>
          <p className="aps-empty-sub">Adicione perfis profissionais de prefeituras, câmaras, secretarias, portais e outras fontes que você quer acompanhar.</p>
          <button type="button" className="aps-btn aps-btn-outline" onClick={() => setModalOpen(true)}><Plus size={14} /> Adicionar perfil</button>
        </div> : <div className="aps-list">
          {sources.map(source => <div className="aps-list-row" key={source.id}>
            <div className="aps-list-row-main">
              <span className="aps-list-row-title">{source.nome}</span>
              <span className="aps-list-row-sub">Última checagem: {formatDate(source.last_checked_at, 'Ainda não verificado')} · Última coleta: {formatDate(source.last_success_at, 'Ainda não verificado')}</span>
              <span className="aps-list-row-sub">Publicações encontradas: {source.last_discovered_count ?? 0} · Novas: {source.last_collected_count ?? 0}{source.last_error_code ? ` · Último erro: ${source.last_error_code}` : ''}</span>
            </div>
            <span className="aps-list-row-tag">{source.ativo ? 'Ativo' : 'Pausado'}</span>
            <div className="aps-list-row-actions">
              <button type="button" className="aps-btn aps-btn-outline" disabled={pendingId === source.id} onClick={() => updateActive(source)}>{source.ativo ? <Pause size={14} /> : <Play size={14} />}{source.ativo ? 'Pausar' : 'Ativar'}</button>
              <button type="button" className="aps-btn aps-btn-outline" disabled={pendingId === source.id} onClick={() => removeSource(source)}><Trash2 size={14} /> Remover</button>
            </div>
          </div>)}
        </div>}
      </section>
    </div>
    {modalOpen && <div className="aps-radar-modal-backdrop" role="presentation">
      <form className="aps-radar-modal" onSubmit={addSource} aria-label="Adicionar perfil monitorado">
        <button className="aps-radar-modal-close" type="button" onClick={() => { setModalOpen(false); setFormError('') }} aria-label="Fechar"><X size={16} /></button>
        <h3>Adicionar perfil</h3>
        <label htmlFor="instagram-radar-profile">@username ou URL do Instagram</label>
        <input id="instagram-radar-profile" className="aps-input" autoFocus placeholder="@prefeituradegoiatuba" value={input} onChange={event => setInput(event.target.value)} />
        {preview && <p className="aps-hint">Será salvo como <strong>@{preview.username}</strong> · {preview.url}</p>}
        {formError && <p role="alert" className="aps-radar-error">{formError}</p>}
        <div className="aps-radar-modal-actions">
          <button type="button" className="aps-btn aps-btn-outline" onClick={() => { setModalOpen(false); setFormError('') }}>Cancelar</button>
          <button type="submit" className="aps-btn aps-btn-primary" disabled={saving}>{saving && <Loader2 size={14} className="aps-spin" />}{saving ? 'Adicionando…' : 'Adicionar perfil'}</button>
        </div>
      </form>
    </div>}
  </div>
}
