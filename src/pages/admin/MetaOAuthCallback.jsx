import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { getMetaConnectionStatus, META_OAUTH_PENDING_TENANT_KEY } from '../../services/metaIntegration'
import { supabase } from '../../services/supabase'

export default function MetaOAuthCallback() {
  const [params] = useSearchParams()
  const [state, setState] = useState('loading')
  useEffect(() => {
    void getMetaConnectionStatus(supabase, window.sessionStorage.getItem(META_OAUTH_PENDING_TENANT_KEY)).then(status => {
      const nextState = status.connected ? 'connected' : (params.get('meta') === 'select' ? 'select' : 'error')
      if (nextState !== 'select') window.sessionStorage.removeItem(META_OAUTH_PENDING_TENANT_KEY)
      setState(nextState)
    }).catch(() => {
      window.sessionStorage.removeItem(META_OAUTH_PENDING_TENANT_KEY)
      setState('error')
    })
  }, [params])
  if (state === 'loading') return <div className="ap-form-section" role="status"><Loader2 className="ap-spin-icon" /> Finalizando conexão Meta…</div>
  if (state === 'connected') return <div className="ap-form-section"><CheckCircle2 color="#15803D" /> Instagram conectado com segurança. <Link to="/admin/autopublisher/settings?section=integrations">Voltar para Integrações</Link></div>
  if (state === 'select') return <div className="ap-form-section">Escolha a conta profissional em <Link to="/admin/autopublisher/settings?section=integrations">Integrações</Link>.</div>
  return <div className="ap-form-section" role="alert"><XCircle color="#B91C1C" /> Não foi possível concluir a conexão. <Link to="/admin/autopublisher/settings?section=integrations">Voltar para Integrações</Link></div>
}
