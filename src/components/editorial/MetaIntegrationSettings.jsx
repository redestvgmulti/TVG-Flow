import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Instagram, Loader2, PlugZap, RefreshCw, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../services/supabase'
import { disconnectMetaConnection, getMetaConnectionStatus, selectMetaConnection, startMetaConnection } from '../../services/metaIntegration'

function formatDate(value) {
  return value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'
}

function statusMessage(code) {
  if (code === 'META_APP_NOT_CONFIGURED') return 'A integração Meta ainda não foi configurada pelo operador.'
  if (code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID') return 'Sua sessão expirou. Entre novamente para consultar a integração.'
  if (code === 'CONFIG_ROLE_FORBIDDEN') return 'Somente administradores podem consultar esta integração.'
  return 'Não foi possível consultar a integração agora.'
}

const capabilityLabel = { radar_read: 'Radar', publishing: 'Publicação', comments: 'Comentários', messages: 'Mensagens' }

export default function MetaIntegrationSettings({ clienteId }) {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try { setStatus(await getMetaConnectionStatus(supabase, clienteId)) }
    catch (error) { setStatus({ connected: false, status: 'error', error_code: error?.message, capabilities: {}, selection_candidates: [] }) }
  }, [clienteId])
  useEffect(() => { void load() }, [load])

  async function connect() {
    setBusy(true)
    try {
      const url = await startMetaConnection(supabase, clienteId)
      window.location.assign(url)
    } catch (error) {
      toast.error(error.message === 'META_APP_NOT_CONFIGURED'
        ? 'A integração Meta ainda não foi configurada pelo operador.'
        : 'Não foi possível iniciar a conexão com Instagram.')
      setBusy(false)
    }
  }
  async function choose(candidateId) {
    setBusy(true)
    try { await selectMetaConnection(supabase, clienteId, candidateId); toast.success('Instagram conectado.'); await load() }
    catch { toast.error('Não foi possível concluir a escolha da conta.') }
    finally { setBusy(false) }
  }
  async function disconnect() {
    setBusy(true)
    try { await disconnectMetaConnection(supabase, clienteId); toast.success('Instagram desconectado.'); await load() }
    catch { toast.error('Não foi possível desconectar o Instagram.') }
    finally { setBusy(false) }
  }

  if (!status) return <div className="aps-card" role="status">Carregando integração Meta…</div>
  const candidates = Array.isArray(status.selection_candidates) ? status.selection_candidates : []
  return <div className="aps-card no-pad">
    <div className="aps-card-head bordered">
      <div><h2 className="aps-card-title"><Instagram size={17} color="#E1306C" /> Instagram / Meta</h2>
        <p className="aps-card-desc">Conecte uma conta profissional para habilitar o Radar e as integrações com Instagram.</p></div>
      <span className={status.connected ? 'aps-connection-state connected' : 'aps-connection-state'}>{status.connected ? '● Conectado' : 'Não conectado'}</span>
    </div>
    <div className="aps-integration-body">
      {candidates.length > 0 && <div className="aps-integration-choice">
        <strong>Escolha a conta profissional</strong><p>A Meta devolveu mais de uma Página elegível. Escolha a conta que será a principal deste tenant.</p>
        {candidates.map(candidate => <button key={candidate.id} type="button" className="aps-choice" disabled={busy} onClick={() => choose(candidate.id)}>
          <span>@{candidate.username}</span><small>{candidate.page_name}</small></button>)}
      </div>}
      {status.connected ? <div className="aps-integration-details">
        <p><strong>@{status.username}</strong></p><p>Página: {status.page_name || '—'}</p>
        <p>Última validação: {formatDate(status.last_validated_at)}</p>
        <div className="aps-capabilities">{Object.entries(capabilityLabel).map(([key, label]) =>
          <span key={key} className={status.capabilities?.[key] ? 'available' : ''}>{status.capabilities?.[key] ? <CheckCircle2 size={14} /> : '○'} {label}</span>)}</div>
        <div className="aps-integration-actions"><button type="button" className="aps-btn aps-btn-outline" disabled={busy} onClick={connect}><RefreshCw size={14} /> Reconectar</button>
          <button type="button" className="aps-btn aps-btn-outline" disabled={busy} onClick={disconnect}><Unplug size={14} /> Desconectar</button></div>
      </div> : <div className="aps-integration-empty"><PlugZap size={28} /><p>Instagram / Meta não conectado.</p>
        {status.error_code && <small>{statusMessage(status.error_code)}</small>}
        <button type="button" className="aps-btn aps-btn-primary" disabled={busy} onClick={connect}>{busy ? <Loader2 size={14} className="ap-spin-icon" /> : <Instagram size={14} />} Conectar Instagram</button>
      </div>}
    </div>
  </div>
}
