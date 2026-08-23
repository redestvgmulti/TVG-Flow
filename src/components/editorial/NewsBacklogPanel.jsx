import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, Link2, Loader2, Plus, RefreshCcw, UserRound } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { supabase } from '../../services/supabase'

const APP_TIME_ZONE = 'America/Sao_Paulo'
const POLL_INTERVAL_MS = 15_000

const panelStyle = {
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: '14px',
    padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px',
}

function dateKey(value) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: APP_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(value))
}

function formatAdoptionTime(value) {
    if (!value) return ''
    const date = new Date(value)
    const time = new Intl.DateTimeFormat('pt-BR', {
        timeZone: APP_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
    }).format(date)

    if (dateKey(value) === dateKey(Date.now())) return `às ${time}`

    const day = new Intl.DateTimeFormat('pt-BR', {
        timeZone: APP_TIME_ZONE,
        day: '2-digit',
        month: '2-digit',
    }).format(date)
    return `${day} às ${time}`
}

function formatCreatedAt(value) {
    if (!value) return ''
    return formatDistanceToNow(new Date(value), { addSuffix: true, locale: ptBR })
}

function sourceLabel(url) {
    try { return new URL(url).hostname.toLowerCase() }
    catch { return url }
}

function adoptionSummary(item) {
    if (!item || item.status === 'available') return 'Disponível.'
    if (item.adopted_by_name_snapshot) {
        return `Adotada por ${item.adopted_by_name_snapshot} ${formatAdoptionTime(item.adopted_at)}.`
    }
    return 'Esta matéria já foi adotada.'
}

function messageFor(error, fallback) {
    const text = String(error?.message || '')
    if (text.includes('BACKLOG_UNAVAILABLE')) return 'Esta matéria acabou de ser adotada por outro usuário.'
    if (text.includes('BACKLOG_TENANT_FORBIDDEN')) return 'Você não tem acesso a este backlog.'
    if (text.includes('BACKLOG_FEATURE_DISABLED')) return 'A fila compartilhada ainda não está habilitada para este tenant.'
    if (text.includes('BACKLOG_URL_INVALID')) return 'Informe um link HTTP ou HTTPS válido.'
    return fallback
}

function validHttpUrl(value) {
    try {
        const parsed = new URL(value)
        return ['http:', 'https:'].includes(parsed.protocol)
            && !parsed.username
            && !parsed.password
            && value.length <= 2048
    } catch {
        return false
    }
}

export default function NewsBacklogPanel({ clienteId, onStartProduction }) {
    const [items, setItems] = useState([])
    const [url, setUrl] = useState('')
    const [loading, setLoading] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [adoptingId, setAdoptingId] = useState(null)
    const [feedback, setFeedback] = useState(null)

    const load = useCallback(async ({ silent = false } = {}) => {
        if (!clienteId) return null
        if (!silent) setLoading(true)
        const { data, error: loadError } = await supabase.schema('ap').rpc('list_news_backlog', {
            p_cliente_id: clienteId,
        })
        if (loadError) {
            if (!silent) {
                setFeedback({ type: 'error', text: messageFor(loadError, 'Não foi possível carregar a fila.') })
            }
            if (!silent) setLoading(false)
            return null
        }
        const nextItems = data ?? []
        setItems(nextItems)
        if (!silent) setLoading(false)
        return nextItems
    }, [clienteId])

    useEffect(() => {
        const initialTimer = window.setTimeout(() => { void load() }, 0)
        const pollTimer = window.setInterval(() => {
            if (document.visibilityState === 'visible') void load({ silent: true })
        }, POLL_INTERVAL_MS)
        const refreshVisibleQueue = () => {
            if (document.visibilityState === 'visible') void load({ silent: true })
        }
        window.addEventListener('focus', refreshVisibleQueue)
        document.addEventListener('visibilitychange', refreshVisibleQueue)
        return () => {
            window.clearTimeout(initialTimer)
            window.clearInterval(pollTimer)
            window.removeEventListener('focus', refreshVisibleQueue)
            document.removeEventListener('visibilitychange', refreshVisibleQueue)
        }
    }, [load])

    const groups = useMemo(() => ({
        available: items.filter(item => item.status === 'available'),
        adopted: items.filter(item => item.status === 'adopted'),
    }), [items])

    async function add(event) {
        event.preventDefault()
        if (submitting || !clienteId) return

        const inputUrl = url.trim()
        if (!inputUrl) {
            setFeedback({ type: 'error', text: 'Cole o link da matéria.' })
            return
        }
        if (!validHttpUrl(inputUrl)) {
            setFeedback({ type: 'error', text: 'Informe um link HTTP ou HTTPS válido.' })
            return
        }

        setSubmitting(true)
        setFeedback(null)
        const { data, error: createError } = await supabase.schema('ap').rpc('create_news_backlog_item', {
            p_cliente_id: clienteId,
            p_url_original: inputUrl,
            p_titulo: null,
            p_observacao: null,
        })

        if (createError) {
            setFeedback({ type: 'error', text: messageFor(createError, 'Não foi possível adicionar a matéria.') })
        } else {
            const result = Array.isArray(data) ? data[0] : data
            const item = result?.item
            setUrl('')
            if (result?.created === false) {
                setFeedback({
                    type: 'info',
                    text: `Esta matéria já está na fila. ${adoptionSummary(item)}`,
                })
            } else {
                setFeedback({ type: 'success', text: 'Matéria adicionada à fila.' })
            }
            await load({ silent: true })
        }
        setSubmitting(false)
    }

    async function createArticle(item) {
        if (adoptingId) return
        setAdoptingId(item.id)
        setFeedback(null)
        const { data, error: adoptError } = await supabase.schema('ap').rpc('adopt_news_backlog_item', {
            p_backlog_id: item.id,
            p_cliente_id: clienteId,
        })

        if (adoptError) {
            const refreshedItems = await load({ silent: true })
            const refreshedItem = refreshedItems?.find(current => current.id === item.id)
            const text = String(adoptError.message || '').includes('BACKLOG_UNAVAILABLE')
                && refreshedItem?.adopted_by_name_snapshot
                ? `Esta matéria acabou de ser adotada por ${refreshedItem.adopted_by_name_snapshot}.`
                : messageFor(adoptError, 'Não foi possível adotar a matéria.')
            setFeedback({ type: 'error', text })
        } else {
            const adoptedItem = Array.isArray(data) ? data[0] : data
            setItems(current => current.map(existing => (
                existing.id === adoptedItem.id ? adoptedItem : existing
            )))
            onStartProduction?.(adoptedItem)
        }
        setAdoptingId(null)
    }

    function renderItem(item) {
        const inProduction = Boolean(item.candidate_news_id)
        return (
            <li key={item.id} style={{ listStyle: 'none', borderTop: '1px solid #f1f5f9', padding: '12px 0', display: 'flex', gap: '12px', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: '#0f172a', fontSize: '14px' }}>
                        <Link2 size={14} aria-hidden="true" /> {sourceLabel(item.url_original)}
                    </div>
                    <div style={{ color: '#64748b', fontSize: '11px', marginTop: '6px' }}>
                        <UserRound size={12} aria-hidden="true" style={{ verticalAlign: 'text-bottom' }} />{' '}
                        adicionado por {item.created_by_name_snapshot || 'Usuário'} {formatCreatedAt(item.created_at)}
                    </div>
                    {item.status === 'adopted' && (
                        <div style={{ color: '#475569', fontSize: '12px', fontWeight: 650, marginTop: '7px' }}>
                            <div>Adotada por {item.adopted_by_name_snapshot || 'usuário editorial'}</div>
                            <div>{formatAdoptionTime(item.adopted_at)}</div>
                            {inProduction && <div style={{ color: '#64748b', marginTop: '3px' }}>Vinculada à produção</div>}
                        </div>
                    )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '6px', flexShrink: 0 }}>
                    <a href={item.url_original} target="_blank" rel="noreferrer" className="ap-btn-refresh">
                        <ExternalLink size={13} aria-hidden="true" /> Abrir Link
                    </a>
                    {item.status === 'available' && (
                        <button
                            type="button"
                            onClick={() => createArticle(item)}
                            className="ap-btn-refresh primary"
                            disabled={Boolean(adoptingId)}
                        >
                            {adoptingId === item.id && <Loader2 size={13} className="ap-spin-icon" aria-hidden="true" />}
                            Criar Matéria
                        </button>
                    )}
                </div>
            </li>
        )
    }

    const feedbackColor = feedback?.type === 'error'
        ? '#b91c1c'
        : feedback?.type === 'success' ? '#166534' : '#1d4ed8'

    return (
        <section style={panelStyle} aria-label="Fila compartilhada de matérias">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <div>
                    <h2 style={{ fontSize: '16px', color: '#0f172a', margin: 0 }}>Fila compartilhada de matérias</h2>
                    <p style={{ fontSize: '12px', color: '#64748b', margin: '3px 0 0' }}>
                        O cadastro salva somente o link. Nenhum conteúdo externo é acessado nesta etapa.
                    </p>
                </div>
                <button type="button" className="ap-btn-refresh" onClick={() => load()} disabled={loading || !clienteId}>
                    <RefreshCcw size={14} className={loading ? 'ap-spin-icon' : ''} aria-hidden="true" /> Atualizar
                </button>
            </div>

            <form onSubmit={add} style={{ display: 'flex', alignItems: 'end', gap: '8px', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', flex: '1 1 320px', flexDirection: 'column', gap: '5px', color: '#334155', fontSize: '12px', fontWeight: 650 }}>
                    Cole o link da matéria
                    <input
                        value={url}
                        onChange={event => setUrl(event.target.value)}
                        required
                        type="url"
                        inputMode="url"
                        autoComplete="url"
                        placeholder="https://site.com/noticia"
                        aria-label="Cole o link da matéria"
                    />
                </label>
                <button className="ap-btn-refresh primary" disabled={submitting || !clienteId} type="submit">
                    {submitting ? <Loader2 size={14} className="ap-spin-icon" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                    Adicionar à fila
                </button>
            </form>

            {feedback && (
                <div role={feedback.type === 'error' ? 'alert' : 'status'} style={{ color: feedbackColor, fontSize: '13px' }}>
                    {feedback.text}
                </div>
            )}

            {loading ? <div style={{ color: '#64748b', fontSize: '13px' }}>Carregando matérias…</div> : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
                    {[
                        ['Pautas disponíveis', groups.available],
                        ['Pautas adotadas', groups.adopted],
                    ].map(([label, group]) => (
                        <div key={label} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0 12px' }}>
                            <h3 style={{ color: '#334155', fontSize: '13px', margin: '12px 0 0' }}>
                                {label} <span style={{ color: '#94a3b8' }}>({group.length})</span>
                            </h3>
                            {group.length === 0
                                ? <p style={{ color: '#94a3b8', fontSize: '12px' }}>Nenhuma matéria nesta seção.</p>
                                : <ul style={{ padding: 0, margin: 0 }}>{group.map(renderItem)}</ul>}
                        </div>
                    ))}
                </div>
            )}
        </section>
    )
}
