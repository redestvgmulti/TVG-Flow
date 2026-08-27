import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ExternalLink, Inbox, Link2, Loader2, Plus, RefreshCcw, Trash2, Zap } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'

const POLL_INTERVAL_MS = 15_000

function formatCreatedAt(value) {
    if (!value) return ''
    return formatDistanceToNow(new Date(value), { addSuffix: true, locale: ptBR })
}

function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, '') }
    catch { return (url || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0] || '—' }
}

function initialsOf(name) {
    return (name || 'P').split(' ').filter(Boolean).slice(0, 2).map(word => word[0].toUpperCase()).join('') || 'P'
}

function messageFor(error, fallback) {
    const text = String(error?.message || '')
    if (text.includes('BACKLOG_UNAVAILABLE')) return 'Esta matéria acabou de ser adotada por outra pessoa.'
    if (text.includes('BACKLOG_DISCARD_FORBIDDEN')) return 'Somente o administrador pode descartar uma matéria disponível.'
    if (text.includes('BACKLOG_TENANT_FORBIDDEN')) return 'Você não tem acesso a este banco de matérias.'
    if (text.includes('BACKLOG_FEATURE_DISABLED')) return 'O Banco de Matérias ainda não está habilitado.'
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
    const { role } = useAuth()
    const canManage = role === 'admin'
    const [items, setItems] = useState([])
    const [detailsOpen, setDetailsOpen] = useState(false)
    const [url, setUrl] = useState('')
    const [title, setTitle] = useState('')
    const [note, setNote] = useState('')
    const [loading, setLoading] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [adoptingId, setAdoptingId] = useState(null)
    const [feedback, setFeedback] = useState(null)
    const [urlFieldError, setUrlFieldError] = useState(false)

    const load = useCallback(async ({ silent = false } = {}) => {
        if (!clienteId) return null
        if (!silent) setLoading(true)
        const { data, error } = await supabase.schema('ap').rpc('list_available_news_backlog', {
            p_cliente_id: clienteId,
        })
        if (error) {
            if (!silent) setFeedback({ type: 'error', text: messageFor(error, 'Não foi possível carregar o Banco de Matérias.') })
            if (!silent) setLoading(false)
            return null
        }
        setItems(data ?? [])
        if (!silent) setLoading(false)
        return data ?? []
    }, [clienteId])

    useEffect(() => {
        const initialTimer = window.setTimeout(() => { void load() }, 0)
        const pollTimer = window.setInterval(() => {
            if (document.visibilityState === 'visible') void load({ silent: true })
        }, POLL_INTERVAL_MS)
        const refresh = () => {
            if (document.visibilityState === 'visible') void load({ silent: true })
        }
        window.addEventListener('focus', refresh)
        document.addEventListener('visibilitychange', refresh)
        return () => {
            window.clearTimeout(initialTimer)
            window.clearInterval(pollTimer)
            window.removeEventListener('focus', refresh)
            document.removeEventListener('visibilitychange', refresh)
        }
    }, [load])

    async function add(event) {
        event.preventDefault()
        if (!canManage || submitting || !clienteId) return
        const inputUrl = url.trim()
        if (!validHttpUrl(inputUrl)) {
            setFeedback({ type: 'error', text: inputUrl ? 'Informe um link HTTP ou HTTPS válido.' : 'Cole o link da matéria.' })
            setUrlFieldError(true)
            return
        }

        setSubmitting(true)
        setFeedback(null)
        const { data, error } = await supabase.schema('ap').rpc('create_news_backlog_item', {
            p_cliente_id: clienteId,
            p_url_original: inputUrl,
            p_titulo: title || null,
            p_observacao: note || null,
        })
        if (error) {
            setFeedback({ type: 'error', text: messageFor(error, 'Não foi possível adicionar a matéria.') })
            setUrlFieldError(true)
        } else {
            setUrl('')
            setTitle('')
            setNote('')
            setDetailsOpen(false)
            setUrlFieldError(false)
            setFeedback({
                type: data?.created === false ? 'info' : 'success',
                text: data?.created === false ? 'Esta matéria já está no banco.' : 'Matéria adicionada ao banco.',
            })
            await load({ silent: true })
        }
        setSubmitting(false)
    }

    async function adopt(item) {
        if (adoptingId) return
        setAdoptingId(item.id)
        setFeedback(null)
        const { data, error } = await supabase.schema('ap').rpc('adopt_news_backlog_item', {
            p_backlog_id: item.id,
            p_cliente_id: clienteId,
        })
        if (error) {
            await load({ silent: true })
            setFeedback({ type: 'error', text: messageFor(error, 'Não foi possível adotar a matéria.') })
        } else {
            const adopted = Array.isArray(data) ? data[0] : data
            setItems(current => current.filter(existing => existing.id !== item.id))
            onStartProduction?.(adopted)
        }
        setAdoptingId(null)
    }

    async function discard(item) {
        if (!canManage) return
        const { error } = await supabase.schema('ap').rpc('discard_news_backlog_item', {
            p_backlog_id: item.id,
            p_cliente_id: clienteId,
        })
        if (error) setFeedback({ type: 'error', text: messageFor(error, 'Não foi possível descartar a matéria.') })
        else {
            setItems(current => current.filter(existing => existing.id !== item.id))
            setFeedback({ type: 'success', text: 'Matéria descartada.' })
        }
    }

    const trimmedUrl = url.trim()
    const previewDomain = validHttpUrl(trimmedUrl) ? domainOf(trimmedUrl) : ''

    return (
        <section className="ap-backlog-panel" aria-label="Banco de Matérias compartilhado">
            <div className="ap-backlog-head">
                <div className="ap-backlog-head-title">
                    <div className="ap-backlog-head-icon"><Inbox size={18} /></div>
                    <div>
                        <h2>Banco de Matérias</h2>
                        <p>Somente pautas aprovadas e disponíveis. Ao adotar, a matéria sai daqui e passa para “Minhas Matérias”.</p>
                    </div>
                </div>
                <div className="ap-backlog-head-actions">
                    <span className="ap-backlog-total"><span className="ap-backlog-total-dot" />{items.length} disponíveis</span>
                    <button type="button" className="ap-btn-refresh" onClick={() => load()} disabled={loading || !clienteId}>
                        <RefreshCcw size={13} className={loading ? 'ap-spin-icon' : ''} /> Atualizar
                    </button>
                </div>
            </div>

            {canManage && (
                <form onSubmit={add} className="ap-backlog-form">
                    <div className="ap-backlog-form-row">
                        <div className={`ap-backlog-url-field${urlFieldError ? ' has-error' : ''}`}>
                            <Link2 size={16} />
                            <input type="url" value={url} onChange={event => { setUrl(event.target.value); setUrlFieldError(false); setFeedback(null) }} placeholder="https://site.com/noticia" aria-label="Link da matéria" />
                            {previewDomain && <span className="ap-backlog-domain-badge">{previewDomain}</span>}
                        </div>
                        <button type="button" className={`ap-backlog-details-btn${detailsOpen ? ' open' : ''}`} onClick={() => setDetailsOpen(open => !open)}>
                            <ChevronDown size={14} /> Detalhes
                        </button>
                        <button className="ap-backlog-submit" disabled={submitting || !clienteId} type="submit">
                            {submitting ? <Loader2 size={14} className="ap-spin-icon" /> : <Plus size={14} />} Adicionar
                        </button>
                    </div>
                    {detailsOpen && (
                        <div className="ap-backlog-form-details">
                            <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Título sugerido (opcional)" />
                            <input value={note} onChange={event => setNote(event.target.value)} placeholder="Observação para quem adotar (opcional)" />
                        </div>
                    )}
                </form>
            )}

            {feedback && <p role={feedback.type === 'error' ? 'alert' : 'status'} className={`ap-backlog-error is-${feedback.type}`}>{feedback.text}</p>}

            {loading ? (
                <div className="ap-backlog-loading">Carregando pautas…</div>
            ) : items.length ? (
                <div className="ap-backlog-list">
                    {items.map(item => (
                        <div key={item.id} className="ap-backlog-item">
                            <div className="ap-backlog-avatar">{initialsOf(item.created_by_name_snapshot)}</div>
                            <div className="ap-backlog-item-main">
                                <span className="ap-backlog-item-title">{item.titulo || domainOf(item.url_original)}</span>
                                <div className="ap-backlog-item-meta">
                                    <span className="ap-backlog-item-domain">{domainOf(item.url_original)}</span>
                                    <span className="ap-backlog-item-dot" />
                                    <span className="ap-backlog-item-meta-text">Disponibilizada por {item.created_by_name_snapshot || 'Administração'} {formatCreatedAt(item.created_at)}</span>
                                </div>
                                {item.observacao && <p className="ap-backlog-item-note">{item.observacao}</p>}
                            </div>
                            <div className="ap-backlog-item-actions">
                                <a href={item.url_original} target="_blank" rel="noreferrer" className="ap-btn-refresh"><ExternalLink size={13} /> Abrir link</a>
                                <button type="button" className="ap-backlog-action-solid" onClick={() => adopt(item)} disabled={Boolean(adoptingId)}>
                                    {adoptingId === item.id ? <Loader2 size={13} className="ap-spin-icon" /> : <Zap size={13} />} Adotar e produzir
                                </button>
                                {canManage && <button type="button" className="ap-backlog-action-icon danger" onClick={() => discard(item)} title="Descartar" aria-label="Descartar matéria"><Trash2 size={14} /></button>}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="ap-backlog-empty">
                    <div className="ap-backlog-empty-icon"><Inbox size={22} /></div>
                    <p className="title">Nenhuma matéria disponível</p>
                    <p className="hint">As matérias aprovadas pelo administrador aparecerão aqui.</p>
                </div>
            )}
        </section>
    )
}
