import { useCallback, useEffect, useState } from 'react'
import { Instagram, Plus, Radar } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { getMetaConnectionStatus } from '../../services/metaIntegration'

export default function InstagramRadarShell({ onConnect, clienteId }) {
  const [status, setStatus] = useState(null)
  const load = useCallback(() => getMetaConnectionStatus(supabase, clienteId).then(setStatus).catch(() => setStatus({ connected: false })), [clienteId])
  useEffect(() => { void load() }, [load])
  if (!status) return <div className="aps-card" role="status">Carregando Radar…</div>
  if (!status.connected) return <div className="aps-card aps-radar-empty">
    <Instagram size={32} color="#E1306C" /><h2>Conecte o Instagram para ativar o Radar.</h2>
    <p>O Radar começa somente depois que uma conta profissional Meta for conectada.</p>
    <button type="button" className="aps-btn aps-btn-primary" onClick={onConnect}>Conectar Instagram</button>
  </div>
  return <div className="aps-card no-pad">
    <div className="aps-card-head bordered"><div><h2 className="aps-card-title"><Radar size={17} color="#E1306C" /> Radar Instagram</h2><p className="aps-card-desc">A descoberta ainda não está ativa nesta fase.</p></div></div>
    <div className="aps-radar-columns"><section><h3>Últimas publicações</h3><p>Nenhuma publicação coletada.</p></section>
      <section><div className="aps-radar-section-head"><div><h3>Perfis monitorados</h3><p>0 perfis monitorados</p></div><button type="button" className="aps-btn aps-btn-outline" disabled title="O cadastro será habilitado na fase de Radar"><Plus size={14} /> Adicionar perfil</button></div>
        <div className="aps-empty"><p className="aps-empty-title">Nenhum perfil monitorado ainda.</p><p className="aps-empty-sub">O formulário @username ou URL estará disponível quando a descoberta for ativada.</p></div></section></div>
  </div>
}
