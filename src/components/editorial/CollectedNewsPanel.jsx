import { useCallback, useEffect, useState } from 'react'
import { Check, ExternalLink, Inbox, Loader2, RefreshCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../services/supabase'

const FILTERS = [
    { key: 'pending_review', label: 'Aguardando curadoria' },
    { key: 'approved', label: 'Aprovadas' },
    { key: 'discarded', label: 'Descartadas' },
    { key: 'duplicate', label: 'Duplicadas' },
]

function domainOf(value) {
    try { return new URL(value).hostname.replace(/^www\./, '') }
    catch { return 'Fonte externa' }
}

function formatDate(value) {
    if (!value) return 'Data não informada'
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(new Date(value))
}

export default function CollectedNewsPanel({ clienteId, onCountsChange }) {
    const [status, setStatus] = useState('pending_review')
    const [items, setItems] = useState([])
    const [counts, setCounts] = useState({})
    const [loading, setLoading] = useState(false)
    const [actingId, setActingId] = useState(null)

    const load = useCallback(async ({ silent = false } = {}) => {
        if (!clienteId) return
        if (!silent) setLoading(true)
        const [listResult, countResult] = await Promise.all([
            supabase.schema('ap').rpc('list_collected_news', {
                p_cliente_id: clienteId,
                p_status: status,
                p_limit: 500,
                p_offset: 0,
            }),
            supabase.schema('ap').rpc('get_collected_news_counts', {
                p_cliente_id: clienteId,
            }),
        ])
        if (listResult.error || countResult.error) {
            toast.error('Não foi possível carregar as matérias coletadas.')
        } else {
            setItems(listResult.data ?? [])
            setCounts(countResult.data ?? {})
            onCountsChange?.(countResult.data ?? {})
        }
        if (!silent) setLoading(false)
    }, [clienteId, onCountsChange, status])

    useEffect(() => {
        const timer = window.setTimeout(() => { void load() }, 0)
        return () => window.clearTimeout(timer)
    }, [load])

    async function approve(item) {
        if (actingId) return
        setActingId(item.id)
        const { data, error } = await supabase.schema('ap').rpc('approve_collected_news', {
            p_cliente_id: clienteId,
            p_collected_news_id: item.id,
        })
        if (error) {
            toast.error('Não foi possível aprovar esta matéria.')
        } else if (data?.duplicate) {
            toast.info('Esta matéria já estava no Banco de Matérias e foi marcada como duplicada.')
        } else {
            toast.success('Matéria aprovada e enviada ao Banco de Matérias.')
        }
        await load({ silent: true })
        setActingId(null)
    }

    async function discard(item) {
        if (actingId) return
        const reason = window.prompt('Motivo do descarte (opcional):', '')
        if (reason === null) return
        setActingId(item.id)
        const { error } = await supabase.schema('ap').rpc('discard_collected_news', {
            p_cliente_id: clienteId,
            p_collected_news_id: item.id,
            p_reason: reason || null,
        })
        if (error) toast.error('Não foi possível descartar esta matéria.')
        else toast.success('Matéria descartada.')
        await load({ silent: true })
        setActingId(null)
    }

    return (
        <section className="ap-collected-panel" aria-label="Matérias coletadas para curadoria">
            <div className="ap-backlog-head">
                <div className="ap-backlog-head-title">
                    <div className="ap-backlog-head-icon"><Inbox size={18} /></div>
                    <div>
                        <h2>Matérias coletadas</h2>
                        <p>Área exclusiva do administrador. Nenhum item entra no Banco de Matérias sem aprovação.</p>
                    </div>
                </div>
                <button type="button" className="ap-btn-refresh" onClick={() => load()} disabled={loading}>
                    <RefreshCcw size={13} className={loading ? 'ap-spin-icon' : ''} /> Atualizar
                </button>
            </div>

            <div className="ap-collected-filters" role="tablist">
                {FILTERS.map(filter => (
                    <button
                        key={filter.key}
                        type="button"
                        role="tab"
                        aria-selected={status === filter.key}
                        className={`ap-backlog-tab${status === filter.key ? ' active' : ''}`}
                        onClick={() => setStatus(filter.key)}
                    >
                        {filter.label}
                        <span className="ap-backlog-tab-count">{counts[filter.key] ?? 0}</span>
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="ap-backlog-loading">Carregando matérias coletadas…</div>
            ) : items.length === 0 ? (
                <div className="ap-backlog-empty">
                    <div className="ap-backlog-empty-icon"><Inbox size={22} /></div>
                    <p className="title">Nenhuma matéria nesta fila</p>
                    <p className="hint">Novas coletas aparecerão aqui depois que o motor visitar as fontes ativas.</p>
                </div>
            ) : (
                <div className="ap-collected-list">
                    {items.map(item => (
                        <article key={item.id} className="ap-collected-item">
                            {item.image_url && <img src={item.image_url} alt="" className="ap-collected-thumb" loading="lazy" />}
                            <div className="ap-collected-main">
                                <div className="ap-collected-source">{item.source_name || domainOf(item.canonical_url)} · coletada em {formatDate(item.collected_at)}</div>
                                <h3>{item.title}</h3>
                                {item.excerpt && <p>{item.excerpt}</p>}
                                <div className="ap-collected-meta">
                                    <span>{domainOf(item.canonical_url)}</span>
                                    <span>Publicada: {formatDate(item.published_at)}</span>
                                    {item.discard_reason && <span>Motivo: {item.discard_reason}</span>}
                                </div>
                            </div>
                            <div className="ap-collected-actions">
                                <a href={item.canonical_url} target="_blank" rel="noreferrer" className="ap-btn-refresh">
                                    <ExternalLink size={13} /> Abrir original
                                </a>
                                {item.status === 'pending_review' && (
                                    <>
                                        <button type="button" className="ap-backlog-action-solid" onClick={() => approve(item)} disabled={Boolean(actingId)}>
                                            {actingId === item.id ? <Loader2 size={13} className="ap-spin-icon" /> : <Check size={13} />} Aprovar
                                        </button>
                                        <button type="button" className="ap-backlog-action-icon danger" onClick={() => discard(item)} disabled={Boolean(actingId)} title="Descartar" aria-label="Descartar matéria">
                                            <Trash2 size={14} />
                                        </button>
                                    </>
                                )}
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    )
}
