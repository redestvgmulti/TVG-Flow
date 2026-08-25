import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ExternalLink, Inbox, Link2, Loader2, Lock, Plus, RefreshCcw, Trash2, Undo2, Zap } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'

const APP_TIME_ZONE = 'America/Sao_Paulo'
const POLL_INTERVAL_MS = 15_000

const AVATAR_PALETTES = [
    { bg: '#EFF6FF', color: '#2563EB' },
    { bg: '#EDE9FE', color: '#6D28D9' },
    { bg: '#ECFDF5', color: '#059669' },
    { bg: '#FEF3E2', color: '#D97706' },
]

const TABS = [
    { key: 'available', label: 'Disponíveis', mobileLabel: 'Disponíveis' },
    { key: 'mine', label: 'Minhas pautas', mobileLabel: 'Minhas' },
    { key: 'others', label: 'Adotadas por outros', mobileLabel: 'Outros' },
]

const EMPTY_COPY = {
    available: { title: 'Nenhuma pauta disponível', hint: 'Cole um link no campo acima para estacionar a pauta sem disparar nenhuma automação.' },
    mine: { title: 'Você ainda não adotou pautas', hint: 'Clique em “Criar Matéria” para assumir uma pauta e iniciar a produção.' },
    others: { title: 'Nenhuma pauta adotada pela equipe', hint: 'Quando alguém adotar uma pauta, ela aparecerá aqui com o responsável e o horário.' },
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

function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, '') }
    catch { return (url || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0] || '—' }
}

function initialsOf(name) {
    const initials = (name || '').split(' ').filter(Boolean).slice(0, 2).map(word => word[0].toUpperCase()).join('')
    return initials || 'U'
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
    if (text.includes('BACKLOG_RELEASE_FORBIDDEN')) return 'Somente quem adotou pode liberar esta pauta.'
    if (text.includes('BACKLOG_DISCARD_FORBIDDEN')) return 'Não foi possível descartar esta pauta.'
    if (text.includes('BACKLOG_TENANT_FORBIDDEN')) return 'Você não tem acesso a este banco de matérias.'
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
    const { user } = useAuth()
    const [items, setItems] = useState([])
    const [tab, setTab] = useState('available')
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
        const { data, error: loadError } = await supabase.schema('ap').rpc('list_news_backlog', {
            p_cliente_id: clienteId,
        })
        if (loadError) {
            if (!silent) {
                setFeedback({ type: 'error', text: messageFor(loadError, 'Não foi possível carregar o banco de matérias.') })
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
        mine: items.filter(item => item.status === 'adopted' && item.adopted_by_user_id === user?.id),
        others: items.filter(item => item.status === 'adopted' && item.adopted_by_user_id !== user?.id),
    }), [items, user?.id])

    const visible = groups[tab] ?? []
    const trimmedUrl = url.trim()
    const hasUrlPreview = validHttpUrl(trimmedUrl)
    const previewDomain = hasUrlPreview ? domainOf(trimmedUrl) : ''

    async function add(event) {
        event.preventDefault()
        if (submitting || !clienteId) return

        const inputUrl = url.trim()
        if (!inputUrl) {
            setFeedback({ type: 'error', text: 'Cole o link da matéria.' })
            setUrlFieldError(true)
            return
        }
        if (!validHttpUrl(inputUrl)) {
            setFeedback({ type: 'error', text: 'Informe um link HTTP ou HTTPS válido.' })
            setUrlFieldError(true)
            return
        }

        setSubmitting(true)
        setFeedback(null)
        const { data, error: createError } = await supabase.schema('ap').rpc('create_news_backlog_item', {
            p_cliente_id: clienteId,
            p_url_original: inputUrl,
            p_titulo: title || null,
            p_observacao: note || null,
        })

        if (createError) {
            setFeedback({ type: 'error', text: messageFor(createError, 'Não foi possível adicionar a matéria.') })
            setUrlFieldError(true)
        } else {
            const result = Array.isArray(data) ? data[0] : data
            const item = result?.item
            setUrl('')
            setTitle('')
            setNote('')
            setDetailsOpen(false)
            setUrlFieldError(false)
            setTab('available')
            if (result?.created === false) {
                setFeedback({ type: 'info', text: `Esta matéria já está na fila. ${adoptionSummary(item)}` })
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
        setUrlFieldError(false)
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

    async function release(item) {
        setFeedback(null)
        const { error: releaseError } = await supabase.schema('ap').rpc('release_news_backlog_item', {
            p_backlog_id: item.id,
            p_cliente_id: clienteId,
        })
        if (releaseError) setFeedback({ type: 'error', text: messageFor(releaseError, 'Não foi possível liberar a pauta.') })
        else setTab('available')
        await load({ silent: true })
    }

    async function discard(item) {
        setFeedback(null)
        const { error: discardError } = await supabase.schema('ap').rpc('discard_news_backlog_item', {
            p_backlog_id: item.id,
            p_cliente_id: clienteId,
        })
        if (discardError) setFeedback({ type: 'error', text: messageFor(discardError, 'Não foi possível descartar a pauta.') })
        else setFeedback({ type: 'success', text: 'Pauta descartada.' })
        await load({ silent: true })
    }

    function begin(item) {
        setFeedback(null)
        onStartProduction?.(item)
    }

    function renderItem(item, index) {
        const mine = item.adopted_by_user_id === user?.id
        const inProduction = Boolean(item.candidate_news_id)
        const palette = AVATAR_PALETTES[index % AVATAR_PALETTES.length]
        const canCreate = item.status === 'available'
        const canResume = mine && !inProduction
        const canRelease = mine && !inProduction
        const canDiscard = item.status === 'available' || (mine && !inProduction)

        return (
            <div key={item.id} className="ap-backlog-item">
                <div className="ap-backlog-avatar" style={{ background: palette.bg, color: palette.color }}>
                    {initialsOf(item.created_by_name_snapshot)}
                </div>

                <div className="ap-backlog-item-main">
                    <div className="ap-backlog-item-title-row">
                        <span className="ap-backlog-item-title">{item.titulo || domainOf(item.url_original)}</span>
                    </div>
                    <div className="ap-backlog-item-meta">
                        <span className="ap-backlog-item-domain">{domainOf(item.url_original)}</span>
                        <span className="ap-backlog-item-dot" />
                        <span className="ap-backlog-item-meta-text">
                            Enviada por {item.created_by_name_snapshot || 'Usuário'} {formatCreatedAt(item.created_at)}
                        </span>
                    </div>
                    {item.status === 'adopted' && (
                        <p className="ap-backlog-item-note">
                            Adotada por {item.adopted_by_name_snapshot || 'usuário editorial'} {formatAdoptionTime(item.adopted_at)}
                            {inProduction ? ' · Em produção' : ''}
                        </p>
                    )}
                    {item.observacao && <p className="ap-backlog-item-note">{item.observacao}</p>}
                </div>

                <div className="ap-backlog-item-actions">
                    <a href={item.url_original} target="_blank" rel="noreferrer" className="ap-btn-refresh">
                        <ExternalLink size={13} aria-hidden="true" /> Abrir Link
                    </a>
                    {canCreate && (
                        <button
                            type="button"
                            className="ap-backlog-action-solid"
                            onClick={() => createArticle(item)}
                            disabled={Boolean(adoptingId)}
                        >
                            {adoptingId === item.id ? <Loader2 size={13} className="ap-spin-icon" /> : <Zap size={13} />}
                            Criar Matéria
                        </button>
                    )}
                    {canResume && (
                        <button type="button" className="ap-backlog-action-solid" onClick={() => begin(item)}>
                            <Zap size={13} /> Gerar matéria
                        </button>
                    )}
                    {canRelease && (
                        <button type="button" className="ap-backlog-action-icon" title="Devolver ao banco de matérias" aria-label="Devolver ao banco de matérias" onClick={() => release(item)}>
                            <Undo2 size={14} />
                        </button>
                    )}
                    {canDiscard && (
                        <button type="button" className="ap-backlog-action-icon danger" title="Descartar" aria-label="Descartar" onClick={() => discard(item)}>
                            <Trash2 size={14} />
                        </button>
                    )}
                    {inProduction && <span className="ap-backlog-locked"><Lock size={13} /> Em produção</span>}
                </div>
            </div>
        )
    }

    return (
        <section className="ap-backlog-panel" aria-label="Banco de matérias compartilhado">
            <div className="ap-backlog-head">
                <div className="ap-backlog-head-title">
                    <div className="ap-backlog-head-icon"><Inbox size={18} /></div>
                    <div>
                        <h2>Banco de Matérias</h2>
                        <p>Guarde o link sem disparar scraping ou automação. A produção começa somente em “Criar Matéria”.</p>
                    </div>
                </div>
                <div className="ap-backlog-head-actions">
                    <span className="ap-backlog-total">
                        <span className="ap-backlog-total-dot" />
                        <span className="ap-backlog-total-label">
                            {items.length} {items.length === 1 ? 'pauta no banco de matérias' : 'pautas no banco de matérias'}
                        </span>
                        <span className="ap-backlog-total-label-mobile">
                            {items.length} {items.length === 1 ? 'pauta' : 'pautas'}
                        </span>
                    </span>
                    <button type="button" className="ap-btn-refresh" onClick={() => load()} disabled={loading || !clienteId}>
                        <RefreshCcw size={13} className={loading ? 'ap-spin-icon' : ''} /> Atualizar
                    </button>
                </div>
            </div>

            <form onSubmit={add} className="ap-backlog-form">
                <div className="ap-backlog-form-row">
                    <div className={`ap-backlog-url-field${urlFieldError ? ' has-error' : ''}`}>
                        <Link2 size={16} />
                        <input
                            type="url"
                            inputMode="url"
                            autoComplete="url"
                            value={url}
                            onChange={event => { setUrl(event.target.value); setFeedback(null); setUrlFieldError(false) }}
                            placeholder="https://site.com/noticia"
                            aria-label="Cole o link da matéria"
                        />
                        {hasUrlPreview && <span className="ap-backlog-domain-badge">{previewDomain}</span>}
                    </div>
                    <button
                        type="button"
                        className={`ap-backlog-details-btn${detailsOpen ? ' open' : ''}`}
                        onClick={() => setDetailsOpen(open => !open)}
                    >
                        <ChevronDown size={14} /> Detalhes
                    </button>
                    <button className="ap-backlog-submit" disabled={submitting || !clienteId} type="submit">
                        {submitting ? <Loader2 size={14} className="ap-spin-icon" /> : <Plus size={14} />} Adicionar
                    </button>
                </div>

                {detailsOpen && (
                    <div className="ap-backlog-form-details">
                        <input value={title} onChange={event => setTitle(event.target.value)} placeholder="Título sugerido (opcional)" aria-label="Título da pauta" />
                        <input value={note} onChange={event => setNote(event.target.value)} placeholder="Observação para quem adotar (opcional)" aria-label="Observação da pauta" />
                    </div>
                )}

                {feedback && <p role={feedback.type === 'error' ? 'alert' : 'status'} className={`ap-backlog-error is-${feedback.type}`}>{feedback.text}</p>}
            </form>

            <div className="ap-backlog-tabs" role="tablist">
                {TABS.map(currentTab => (
                    <button
                        key={currentTab.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === currentTab.key}
                        className={`ap-backlog-tab${tab === currentTab.key ? ' active' : ''}`}
                        onClick={() => setTab(currentTab.key)}
                    >
                        <span className="ap-backlog-tab-label">{currentTab.label}</span>
                        <span className="ap-backlog-tab-label-mobile">{currentTab.mobileLabel}</span>
                        <span className="ap-backlog-tab-count">{groups[currentTab.key].length}</span>
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="ap-backlog-loading">Carregando pautas…</div>
            ) : visible.length > 0 ? (
                <div className="ap-backlog-list">{visible.map(renderItem)}</div>
            ) : (
                <div className="ap-backlog-empty">
                    <div className="ap-backlog-empty-icon"><Inbox size={22} /></div>
                    <p className="title">{EMPTY_COPY[tab].title}</p>
                    <p className="hint">{EMPTY_COPY[tab].hint}</p>
                </div>
            )}
        </section>
    )
}
