import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, FileText, Loader2, RefreshCcw, Undo2, Zap } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '../../services/supabase'
import { resolveOperationalClienteId } from '../../services/visualTitleGroups'
import '../../styles/AutoPublisher.css'

const STATUS_LABELS = {
    adopted: 'Adotada · aguardando produção',
    in_production: 'Em produção',
    completed: 'Produção concluída',
}

function formatDate(value) {
    if (!value) return '—'
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(new Date(value))
}

function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, '') }
    catch { return 'Fonte externa' }
}

export default function MyNewsWork() {
    const [, setSearchParams] = useSearchParams()
    const [clienteId, setClienteId] = useState(null)
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(true)
    const [releasingId, setReleasingId] = useState(null)

    useEffect(() => {
        let active = true
        resolveOperationalClienteId(supabase)
            .then(id => { if (active) setClienteId(id) })
            .catch(() => { if (active) toast.error('Não foi possível identificar o cliente operacional.') })
        return () => { active = false }
    }, [])

    const load = useCallback(async () => {
        if (!clienteId) return
        setLoading(true)
        const { data, error } = await supabase.schema('ap').rpc('list_my_news_work', {
            p_cliente_id: clienteId,
        })
        if (error) toast.error('Não foi possível carregar suas matérias.')
        else setItems(data ?? [])
        setLoading(false)
    }, [clienteId])

    useEffect(() => {
        const timer = window.setTimeout(() => { void load() }, 0)
        return () => window.clearTimeout(timer)
    }, [load])

    function openProduction(item) {
        setSearchParams(params => {
            params.set('modal', 'employee-mode')
            if (item.status === 'adopted' && !item.candidate_news_id) {
                params.set('backlog_id', item.id)
                params.set('tab', 'create')
            } else {
                params.delete('backlog_id')
                params.set('tab', 'history')
            }
            return params
        })
    }

    async function release(item) {
        if (releasingId) return
        setReleasingId(item.id)
        const { error } = await supabase.schema('ap').rpc('release_news_backlog_item', {
            p_backlog_id: item.id,
            p_cliente_id: clienteId,
        })
        if (error) toast.error('Não foi possível devolver esta matéria ao banco.')
        else {
            setItems(current => current.filter(existing => existing.id !== item.id))
            toast.success('Matéria devolvida ao Banco de Matérias.')
        }
        setReleasingId(null)
    }

    return (
        <div className="ap-page ap-my-work-page">
            <div className="ap-header">
                <div className="ap-header-left">
                    <h1>Minhas Matérias</h1>
                    <p>Acompanhe as matérias que você adotou e continue cada produção.</p>
                </div>
                <button type="button" className="ap-btn-refresh" onClick={load} disabled={loading || !clienteId}>
                    <RefreshCcw size={14} className={loading ? 'ap-spin-icon' : ''} /> Atualizar
                </button>
            </div>

            {loading ? (
                <div className="ap-backlog-loading">Carregando suas matérias…</div>
            ) : items.length === 0 ? (
                <div className="ap-backlog-empty ap-my-work-empty">
                    <div className="ap-backlog-empty-icon"><FileText size={22} /></div>
                    <p className="title">Você não tem matérias adotadas</p>
                    <p className="hint">Adote uma pauta no Banco de Matérias para ela aparecer aqui.</p>
                </div>
            ) : (
                <div className="ap-my-work-grid">
                    {items.map(item => (
                        <article key={item.id} className="ap-my-work-card">
                            <div className={`ap-my-work-status is-${item.status}`}>{STATUS_LABELS[item.status] || item.status}</div>
                            <h2>{item.titulo || domainOf(item.url_original)}</h2>
                            <p className="ap-my-work-domain">{domainOf(item.url_original)}</p>
                            {item.observacao && <p className="ap-my-work-note">{item.observacao}</p>}
                            <dl>
                                <div><dt>Adotada em</dt><dd>{formatDate(item.adopted_at)}</dd></div>
                                <div><dt>Produção iniciada</dt><dd>{formatDate(item.production_started_at)}</dd></div>
                                <div><dt>Concluída em</dt><dd>{formatDate(item.production_completed_at)}</dd></div>
                            </dl>
                            <div className="ap-my-work-actions">
                                <a href={item.url_original} target="_blank" rel="noreferrer" className="ap-btn-refresh"><ExternalLink size={13} /> Original</a>
                                <button type="button" className="ap-backlog-action-solid" onClick={() => openProduction(item)}>
                                    <Zap size={13} /> {item.status === 'adopted' ? 'Continuar produção' : 'Ver produção'}
                                </button>
                                {item.status === 'adopted' && !item.candidate_news_id && (
                                    <button type="button" className="ap-backlog-action-icon" onClick={() => release(item)} disabled={Boolean(releasingId)} title="Devolver ao Banco de Matérias" aria-label="Devolver ao Banco de Matérias">
                                        {releasingId === item.id ? <Loader2 size={14} className="ap-spin-icon" /> : <Undo2 size={14} />}
                                    </button>
                                )}
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </div>
    )
}
