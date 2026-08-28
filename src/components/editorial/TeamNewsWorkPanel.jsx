import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, History, Loader2, RefreshCcw, Undo2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../services/supabase'

const STATUS_LABELS = {
    adopted: 'Adotada',
    in_production: 'Em produção',
    completed: 'Produção concluída',
    pending_render: 'Renderizando',
    processing: 'Em produção',
    pending_review: 'Aguardando revisão',
    approved: 'Aprovada',
    posted: 'Publicada',
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

export default function TeamNewsWorkPanel({ clienteId }) {
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(false)
    const [filter, setFilter] = useState('all')
    const [actingId, setActingId] = useState(null)
    const [timelineFor, setTimelineFor] = useState(null)
    const [timeline, setTimeline] = useState([])
    const [timelineLoading, setTimelineLoading] = useState(false)

    const load = useCallback(async ({ silent = false } = {}) => {
        if (!clienteId) return
        if (!silent) setLoading(true)
        const { data, error } = await supabase.schema('ap').rpc('list_team_news_work_details', {
            p_cliente_id: clienteId,
        })
        if (error) toast.error('Não foi possível carregar a operação editorial.')
        else setItems(data ?? [])
        if (!silent) setLoading(false)
    }, [clienteId])

    useEffect(() => {
        const timer = window.setTimeout(() => { void load() }, 0)
        return () => window.clearTimeout(timer)
    }, [load])

    async function returnToBank(item) {
        if (actingId) return
        const reason = window.prompt('Motivo da devolução administrativa (opcional):', '')
        if (reason === null) return
        setActingId(item.backlog_id)
        const { error } = await supabase.schema('ap').rpc('admin_release_news_backlog_item', {
            p_backlog_id: item.backlog_id,
            p_cliente_id: clienteId,
            p_reason: reason || null,
        })
        if (error) {
            toast.error('Não foi possível devolver esta pauta. Ela pode já ter iniciado produção.')
        } else {
            toast.success('Pauta devolvida ao Banco de Matérias com registro de auditoria.')
            setItems(current => current.filter(currentItem => currentItem.backlog_id !== item.backlog_id))
            if (timelineFor === item.backlog_id) {
                setTimelineFor(null)
                setTimeline([])
            }
        }
        setActingId(null)
    }

    async function toggleTimeline(item) {
        if (timelineFor === item.backlog_id) {
            setTimelineFor(null)
            setTimeline([])
            return
        }
        setTimelineFor(item.backlog_id)
        setTimelineLoading(true)
        const { data, error } = await supabase.schema('ap').rpc('list_news_backlog_timeline', {
            p_backlog_id: item.backlog_id,
            p_cliente_id: clienteId,
        })
        if (error) {
            toast.error('Não foi possível carregar o histórico desta pauta.')
            setTimelineFor(null)
        } else {
            setTimeline(data ?? [])
        }
        setTimelineLoading(false)
    }

    const visibleItems = items.filter(item => {
        if (filter === 'all') return true
        return item.backlog_status === filter || item.candidate_status === filter
    })

    return (
        <section className="ap-backlog-panel" aria-label="Operação editorial da equipe">
            <div className="ap-backlog-head">
                <div className="ap-backlog-head-title">
                    <div className="ap-backlog-head-icon"><Users size={18} /></div>
                    <div>
                        <h2>Operação editorial</h2>
                        <p>Acompanhe pautas adotadas e produções da equipe. Devoluções administrativas só são permitidas antes da criação da produção.</p>
                    </div>
                </div>
                <button type="button" className="ap-btn-refresh" onClick={() => load()} disabled={loading || !clienteId}>
                    <RefreshCcw size={13} className={loading ? 'ap-spin-icon' : ''} /> Atualizar
                </button>
            </div>

            <div className="ap-collected-filters" role="tablist" aria-label="Filtro da operação editorial">
                {[
                    ['all', 'Todas'],
                    ['adopted', 'Adotadas'],
                    ['in_production', 'Em produção'],
                    ['completed', 'Concluídas'],
                ].map(([key, label]) => (
                    <button key={key} type="button" role="tab" aria-selected={filter === key}
                        className={`ap-backlog-tab${filter === key ? ' active' : ''}`} onClick={() => setFilter(key)}>
                        {label}
                    </button>
                ))}
            </div>

            {loading ? <div className="ap-backlog-loading">Carregando operação editorial…</div>
                : visibleItems.length === 0 ? <div className="ap-backlog-empty"><p className="title">Nenhuma pauta em andamento</p><p className="hint">As pautas adotadas pela equipe aparecerão aqui.</p></div>
                : <div className="ap-collected-list">
                    {visibleItems.map(item => (
                        <article key={item.backlog_id} className="ap-collected-item">
                            <div className="ap-collected-main">
                                <div className="ap-collected-source">{item.adopted_by_name_snapshot || 'Responsável não informado'} · adotada em {formatDate(item.adopted_at)}</div>
                                <h3>{item.titulo || domainOf(item.url_original)}</h3>
                                <div className="ap-collected-meta">
                                    <span>{domainOf(item.url_original)}</span>
                                    <span>Pauta: {STATUS_LABELS[item.backlog_status] || item.backlog_status}</span>
                                    {item.candidate_status && <span>Produção: {STATUS_LABELS[item.candidate_status] || item.candidate_status}</span>}
                                    {item.candidate_content_type && <span>Formato: {item.candidate_content_type}</span>}
                                    <span>Início: {formatDate(item.production_started_at)}</span>
                                </div>
                            </div>
                            <div className="ap-collected-actions">
                                <a href={item.url_original} target="_blank" rel="noreferrer" className="ap-btn-refresh"><ExternalLink size={13} /> Fonte</a>
                                <button type="button" className="ap-btn-refresh" onClick={() => toggleTimeline(item)} disabled={timelineLoading && timelineFor === item.backlog_id}>
                                    {timelineLoading && timelineFor === item.backlog_id ? <Loader2 size={13} className="ap-spin-icon" /> : <History size={13} />} Histórico
                                </button>
                                {item.backlog_status === 'adopted' && !item.candidate_news_id && (
                                    <button type="button" className="ap-backlog-action-icon" title="Devolver administrativamente ao Banco de Matérias" aria-label="Devolver administrativamente ao Banco de Matérias" onClick={() => returnToBank(item)} disabled={Boolean(actingId)}>
                                        {actingId === item.backlog_id ? <Loader2 size={14} className="ap-spin-icon" /> : <Undo2 size={14} />}
                                    </button>
                                )}
                            </div>
                            {timelineFor === item.backlog_id && (
                                <div className="ap-editorial-timeline">
                                    {timelineLoading ? 'Carregando histórico…' : timeline.length === 0 ? 'Sem eventos disponíveis para esta pauta.' : timeline.map((event, index) => (
                                        <div key={`${event.event_at}-${event.action}-${index}`} className="ap-editorial-timeline-event">
                                            <strong>{formatDate(event.event_at)}</strong>
                                            <span>{event.action.replaceAll('_', ' ')}</span>
                                            {event.actor_name && <span>{event.actor_name}</span>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </article>
                    ))}
                </div>}
        </section>
    )
}
