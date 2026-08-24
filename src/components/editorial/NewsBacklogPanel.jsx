import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Inbox, Link2, Loader2, Lock, Pencil, Plus, RefreshCcw, Trash2, Undo2, X, Zap } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'

const AVATAR_PALETTES = [
    { bg: '#EFF6FF', color: '#2563EB' },
    { bg: '#EDE9FE', color: '#6D28D9' },
    { bg: '#ECFDF5', color: '#059669' },
    { bg: '#FEF3E2', color: '#D97706' },
]

const TABS = [
    { key: 'available', label: 'Disponíveis' },
    { key: 'mine', label: 'Minhas pautas' },
    { key: 'others', label: 'Adotadas por outros' },
]

const EMPTY_COPY = {
    available: { title: 'Nenhuma pauta disponível', hint: 'Cole um link no campo acima para estacionar a pauta sem disparar nenhuma automação.' },
    mine: { title: 'Você ainda não adotou pautas', hint: 'Adote uma pauta em "Disponíveis" para reservá-la antes de gerar a matéria.' },
    others: { title: 'Nenhuma pauta adotada pela equipe', hint: 'Quando alguém adotar uma pauta do banco de matérias, ela aparece aqui com o responsável.' },
}

function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, '') }
    catch { return (url || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0] || '—' }
}

function isInstagramUrl(url) {
    try { return /(^|\.)instagram\.com$/i.test(new URL(url).hostname) }
    catch { return /(^|\.)instagram\.com([/:]|$)/i.test(url || '') }
}

function titleFromMetadata(value, url) {
    const title = String(value || '').replace(/\s+/g, ' ').trim()
    const domain = domainOf(url).toLocaleLowerCase('pt-BR')
    const normalized = title.toLocaleLowerCase('pt-BR')
    if (title.length < 3 || title.length > 240 || normalized === domain || normalized === 'instagram') return ''
    return title
}

function initialsOf(name) {
    const initials = (name || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
    return initials || 'U'
}

function timeLabel(value) {
    if (!value) return ''
    const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000))
    if (minutes < 1) return 'agora mesmo'
    if (minutes < 60) return `há ${minutes} min`
    const hours = Math.floor(minutes / 60)
    return hours < 24 ? `há ${hours}h` : `há ${Math.floor(hours / 24)}d`
}

function messageFor(error, fallback) {
    const text = String(error?.message || '')
    if (text.includes('BACKLOG_UNAVAILABLE')) return 'Esta pauta acabou de ser adotada por outro usuário.'
    if (text.includes('BACKLOG_RELEASE_FORBIDDEN')) return 'Somente quem adotou pode liberar esta pauta.'
    if (text.includes('BACKLOG_DISCARD_FORBIDDEN')) return 'Não foi possível descartar esta pauta.'
    if (text.includes('BACKLOG_TENANT_FORBIDDEN')) return 'Você não tem acesso a este banco de matérias.'
    if (text.includes('BACKLOG_URL_INVALID')) return 'Informe um link HTTP ou HTTPS válido.'
    return fallback
}

export default function NewsBacklogPanel({ clienteId, onStartProduction }) {
    const { user } = useAuth()
    const [items, setItems] = useState([])
    const [tab, setTab] = useState('available')
    const [detailsOpen, setDetailsOpen] = useState(false)
    const [url, setUrl] = useState('')
    const [title, setTitle] = useState('')
    const [note, setNote] = useState('')
    const [titleLookupState, setTitleLookupState] = useState('idle')
    const [titleFieldError, setTitleFieldError] = useState(false)
    const [editingItemId, setEditingItemId] = useState(null)
    const [editingTitle, setEditingTitle] = useState('')
    const [loading, setLoading] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')
    const [urlFieldError, setUrlFieldError] = useState(false)
    const titleLookupRequest = useRef(0)

    const load = useCallback(async () => {
        if (!clienteId) return
        setLoading(true)
        setError('')
        const { data, error: loadError } = await supabase.schema('ap').rpc('list_news_backlog', {
            p_cliente_id: clienteId,
        })
        if (loadError) setError(messageFor(loadError, 'Não foi possível carregar o banco de matérias.'))
        else setItems(data ?? [])
        setLoading(false)
    }, [clienteId])

    useEffect(() => {
        const timer = window.setTimeout(() => { void load() }, 0)
        return () => window.clearTimeout(timer)
    }, [load])

    const groups = useMemo(() => ({
        available: items.filter(item => item.status === 'available'),
        mine: items.filter(item => item.status === 'adopted' && item.adopted_by_user_id === user?.id),
        others: items.filter(item => item.status === 'adopted' && item.adopted_by_user_id !== user?.id),
    }), [items, user?.id])

    const visible = groups[tab] ?? []
    const trimmedUrl = url.trim()
    const hasUrlPreview = trimmedUrl.length > 3
    const previewDomain = hasUrlPreview ? domainOf(/^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`) : ''

    async function suggestTitle(rawValue) {
        const raw = String(rawValue || '').trim()
        if (!raw) return
        const finalUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
        if (isInstagramUrl(finalUrl)) {
            setDetailsOpen(true)
            setTitleLookupState('manual_instagram')
            return
        }

        const requestId = titleLookupRequest.current + 1
        titleLookupRequest.current = requestId
        setTitleLookupState('loading')
        try {
            const { data, error: scrapeError } = await supabase.functions.invoke('ap-link-scraper', {
                body: { url: finalUrl },
            })
            if (requestId !== titleLookupRequest.current) return
            const suggested = scrapeError ? '' : titleFromMetadata(data?.title, finalUrl)
            if (suggested) {
                setTitle(suggested)
                setDetailsOpen(true)
                setTitleLookupState('found')
            } else {
                setDetailsOpen(true)
                setTitleLookupState('manual')
            }
        } catch {
            if (requestId === titleLookupRequest.current) {
                setDetailsOpen(true)
                setTitleLookupState('manual')
            }
        }
    }

    async function add(e) {
        e.preventDefault()
        if (submitting || !clienteId) return
        const raw = url.trim()
        if (!raw) { setError('Cole um link para adicionar a pauta ao banco de matérias.'); setUrlFieldError(true); return }
        const finalUrl = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
        if (items.some(item => item.url_original === finalUrl)) {
            setError('Esse link já está no banco de matérias.')
            setUrlFieldError(true)
            return
        }

        if (title.trim().length < 3) {
            setDetailsOpen(true)
            setTitleFieldError(true)
            setError(isInstagramUrl(finalUrl)
                ? 'Para links do Instagram, informe um título curto para a pauta.'
                : 'Informe um título para a pauta antes de adicionar.')
            return
        }

        setSubmitting(true)
        setError('')
        const { error: createError } = await supabase.schema('ap').rpc('create_news_backlog_item', {
            p_cliente_id: clienteId,
            p_url_original: finalUrl,
            p_titulo: title || null,
            p_observacao: note || null,
        })
        if (createError) {
            setError(messageFor(createError, 'Não foi possível adicionar a pauta.'))
            setUrlFieldError(true)
        } else {
            setUrl('')
            setTitle('')
            setNote('')
            setTitleLookupState('idle')
            setTitleFieldError(false)
            setDetailsOpen(false)
            setUrlFieldError(false)
            setTab('available')
            await load()
        }
        setSubmitting(false)
    }

    async function adopt(item) {
        setError('')
        setUrlFieldError(false)
        const { error: adoptError } = await supabase.schema('ap').rpc('adopt_news_backlog_item', {
            p_backlog_id: item.id,
            p_cliente_id: clienteId,
        })
        if (adoptError) setError(messageFor(adoptError, 'Não foi possível adotar a pauta.'))
        else setTab('mine')
        await load()
    }

    async function release(item) {
        setError('')
        setUrlFieldError(false)
        const { error: releaseError } = await supabase.schema('ap').rpc('release_news_backlog_item', {
            p_backlog_id: item.id,
            p_cliente_id: clienteId,
        })
        if (releaseError) setError(messageFor(releaseError, 'Não foi possível liberar a pauta.'))
        await load()
    }

    async function discard(item) {
        setError('')
        setUrlFieldError(false)
        const { error: discardError } = await supabase.schema('ap').rpc('discard_news_backlog_item', {
            p_backlog_id: item.id,
            p_cliente_id: clienteId,
        })
        if (discardError) setError(messageFor(discardError, 'Não foi possível descartar a pauta.'))
        await load()
    }

    function beginTitleEdit(item) {
        setEditingItemId(item.id)
        setEditingTitle(item.titulo || '')
        setError('')
    }

    async function saveTitle(item) {
        const nextTitle = editingTitle.trim()
        if (nextTitle.length < 3) {
            setError('O título precisa ter pelo menos 3 caracteres.')
            return
        }
        setError('')
        const { error: updateError } = await supabase.schema('ap').rpc('update_news_backlog_title', {
            p_backlog_id: item.id,
            p_cliente_id: clienteId,
            p_titulo: nextTitle,
        })
        if (updateError) {
            setError(messageFor(updateError, 'Não foi possível atualizar o título da pauta.'))
            return
        }
        setEditingItemId(null)
        setEditingTitle('')
        await load()
    }

    function begin(item) {
        setError('')
        onStartProduction?.(item)
    }

    function renderItem(item, index) {
        const mine = item.adopted_by_user_id === user?.id
        const inProduction = Boolean(item.candidate_news_id)
        const palette = AVATAR_PALETTES[index % AVATAR_PALETTES.length]

        const canAdopt = item.status === 'available'
        const canGenerate = mine && !inProduction
        const canRelease = mine && !inProduction
        const canDiscard = item.status === 'available' || (mine && !inProduction)
        const locked = inProduction

        const senderMeta = `Enviada por ${item.created_by_name_snapshot || 'Usuário'} ${timeLabel(item.created_at)}`
        const metaText = (item.status === 'adopted' && !mine)
            ? `Adotada por ${item.adopted_by_name_snapshot || 'alguém'} · ${senderMeta}`
            : senderMeta

        return (
            <div key={item.id} className="ap-backlog-item">
                <div className="ap-backlog-avatar" style={{ background: palette.bg, color: palette.color }}>
                    {initialsOf(item.created_by_name_snapshot)}
                </div>

                <div className="ap-backlog-item-main">
                    <div className="ap-backlog-item-title-row">
                        {editingItemId === item.id ? (
                            <div className="ap-backlog-inline-title-edit">
                                <input value={editingTitle} onChange={event => setEditingTitle(event.target.value)} aria-label="Novo título da pauta" autoFocus />
                                <button type="button" onClick={() => saveTitle(item)} aria-label="Salvar título"><Check size={14} /></button>
                                <button type="button" onClick={() => setEditingItemId(null)} aria-label="Cancelar edição"><X size={14} /></button>
                            </div>
                        ) : (
                            <>
                                <span className="ap-backlog-item-title">{item.titulo || 'Título pendente'}</span>
                                {canDiscard && <button type="button" className="ap-backlog-title-edit" onClick={() => beginTitleEdit(item)} title="Editar título" aria-label="Editar título"><Pencil size={13} /></button>}
                            </>
                        )}
                    </div>
                    <div className="ap-backlog-item-meta">
                        <span className="ap-backlog-item-domain">{domainOf(item.url_original)}</span>
                        <span className="ap-backlog-item-dot" />
                        <span className="ap-backlog-item-meta-text">{metaText}</span>
                    </div>
                    {item.observacao && <p className="ap-backlog-item-note">{item.observacao}</p>}
                </div>

                <div className="ap-backlog-item-actions">
                    {canAdopt && (
                        <button type="button" className="ap-backlog-action-solid" onClick={() => adopt(item)}>
                            Adotar pauta
                        </button>
                    )}
                    {canGenerate && (
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
                    {locked && (
                        <span className="ap-backlog-locked"><Lock size={13} /> Em produção</span>
                    )}
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
                        <p>Guarde o link sem compromisso — nada acontece até alguém da equipe adotar para produzir.</p>
                    </div>
                </div>
                <div className="ap-backlog-head-actions">
                    <span className="ap-backlog-total">
                        <span className="ap-backlog-total-dot" />
                        {items.length} {items.length === 1 ? 'pauta no banco de matérias' : 'pautas no banco de matérias'}
                    </span>
                    <button type="button" className="ap-btn-refresh" onClick={load} disabled={loading || !clienteId}>
                        <RefreshCcw size={13} className={loading ? 'ap-spin-icon' : ''} /> Atualizar
                    </button>
                </div>
            </div>

            <form onSubmit={add} className="ap-backlog-form">
                <div className="ap-backlog-form-row">
                    <div className={`ap-backlog-url-field${urlFieldError ? ' has-error' : ''}`}>
                        <Link2 size={16} />
                        <input
                            type="text"
                            value={url}
                            onChange={e => {
                                titleLookupRequest.current += 1
                                setUrl(e.target.value)
                                setTitle('')
                                setTitleLookupState('idle')
                                setError('')
                                setUrlFieldError(false)
                                setTitleFieldError(false)
                            }}
                            onBlur={event => { void suggestTitle(event.target.value) }}
                            onPaste={event => {
                                const pastedUrl = event.clipboardData.getData('text')
                                window.setTimeout(() => { void suggestTitle(pastedUrl) }, 0)
                            }}
                            placeholder="Cole o link da pauta e pressione Enter"
                            aria-label="Link da pauta"
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
                        <div className="ap-backlog-title-field">
                            <input value={title} onChange={e => { setTitle(e.target.value); setTitleFieldError(false) }} placeholder="Título da pauta" aria-label="Título da pauta" className={titleFieldError ? 'has-error' : ''} />
                            {titleLookupState === 'loading' && <span>Buscando título...</span>}
                            {titleLookupState === 'found' && <span>Título encontrado. Você pode ajustar.</span>}
                            {titleLookupState === 'manual_instagram' && <span>Instagram: informe o título manualmente.</span>}
                            {titleLookupState === 'manual' && <span>Não foi possível obter um título. Informe-o manualmente.</span>}
                        </div>
                        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Observação para quem adotar (opcional)" aria-label="Observação da pauta" />
                    </div>
                )}

                {error && <p role="alert" className="ap-backlog-error">{error}</p>}
            </form>

            <div className="ap-backlog-tabs" role="tablist">
                {TABS.map(t => (
                    <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.key}
                        className={`ap-backlog-tab${tab === t.key ? ' active' : ''}`}
                        onClick={() => setTab(t.key)}
                    >
                        {t.label}
                        <span className="ap-backlog-tab-count">{groups[t.key].length}</span>
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
