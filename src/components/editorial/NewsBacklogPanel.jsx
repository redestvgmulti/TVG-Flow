import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link2, Loader2, Play, Plus, RefreshCcw, Undo2, UserRound } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'

const panelStyle = {
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: '14px',
    padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px',
}

function formatDate(value) {
    if (!value) return '—'
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function fallbackTitle(url) {
    try { return new URL(url).hostname }
    catch { return url }
}

function messageFor(error, fallback) {
    const text = String(error?.message || '')
    if (text.includes('BACKLOG_UNAVAILABLE')) return 'Esta pauta acabou de ser adotada por outro usuário.'
    if (text.includes('BACKLOG_RELEASE_FORBIDDEN')) return 'Somente quem adotou pode liberar esta pauta.'
    if (text.includes('BACKLOG_TENANT_FORBIDDEN')) return 'Você não tem acesso a este backlog.'
    if (text.includes('BACKLOG_URL_INVALID')) return 'Informe um link HTTP ou HTTPS válido.'
    return fallback
}

export default function NewsBacklogPanel({ clienteId, onStartProduction }) {
    const { user } = useAuth()
    const [items, setItems] = useState([])
    const [url, setUrl] = useState('')
    const [title, setTitle] = useState('')
    const [note, setNote] = useState('')
    const [loading, setLoading] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')

    const load = useCallback(async () => {
        if (!clienteId) return
        setLoading(true)
        setError('')
        const { data, error: loadError } = await supabase.schema('ap').rpc('list_news_backlog', {
            p_cliente_id: clienteId,
        })
        if (loadError) setError(messageFor(loadError, 'Não foi possível carregar o backlog.'))
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

    async function add(e) {
        e.preventDefault()
        if (submitting || !clienteId) return
        setSubmitting(true)
        setError('')
        const { error: createError } = await supabase.schema('ap').rpc('create_news_backlog_item', {
            p_cliente_id: clienteId,
            p_url_original: url,
            p_titulo: title || null,
            p_observacao: note || null,
        })
        if (createError) setError(messageFor(createError, 'Não foi possível adicionar a pauta.'))
        else {
            setUrl('')
            setTitle('')
            setNote('')
            await load()
        }
        setSubmitting(false)
    }

    async function adopt(item) {
        setError('')
        const { error: adoptError } = await supabase.schema('ap').rpc('adopt_news_backlog_item', {
            p_backlog_id: item.id,
            p_cliente_id: clienteId,
        })
        if (adoptError) setError(messageFor(adoptError, 'Não foi possível adotar a pauta.'))
        await load()
    }

    async function release(item) {
        setError('')
        const { error: releaseError } = await supabase.schema('ap').rpc('release_news_backlog_item', {
            p_backlog_id: item.id,
            p_cliente_id: clienteId,
        })
        if (releaseError) setError(messageFor(releaseError, 'Não foi possível liberar a pauta.'))
        await load()
    }

    function begin(item) {
        setError('')
        onStartProduction?.(item)
    }

    function renderItem(item) {
        const mine = item.adopted_by_user_id === user?.id
        const inProduction = Boolean(item.candidate_news_id)
        return (
            <li key={item.id} style={{ listStyle: 'none', borderTop: '1px solid #f1f5f9', padding: '12px 0', display: 'flex', gap: '12px', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '14px' }}>{item.titulo || fallbackTitle(item.url_original)}</div>
                    <a href={item.url_original} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontSize: '12px', overflowWrap: 'anywhere' }}>{item.url_original}</a>
                    {item.observacao && <div style={{ color: '#64748b', fontSize: '12px', marginTop: '3px' }}>{item.observacao}</div>}
                    <div style={{ color: '#64748b', fontSize: '11px', marginTop: '6px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <span><UserRound size={12} style={{ verticalAlign: 'text-bottom' }} /> {item.created_by_name_snapshot || 'Usuário'} · {formatDate(item.created_at)}</span>
                        {item.adopted_by_name_snapshot && <span>Adotada por {item.adopted_by_name_snapshot} · {formatDate(item.adopted_at)}</span>}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    {item.status === 'available' && <button type="button" onClick={() => adopt(item)} className="ap-btn-refresh primary">Adotar</button>}
                    {mine && !inProduction && <>
                        <button type="button" onClick={() => begin(item)} className="ap-btn-refresh primary"><Play size={13} /> Produzir</button>
                        <button type="button" onClick={() => release(item)} className="ap-btn-refresh"><Undo2 size={13} /> Liberar</button>
                    </>}
                    {mine && inProduction && <span style={{ color: '#64748b', fontSize: '12px', fontWeight: 600 }}>Em produção</span>}
                </div>
            </li>
        )
    }

    return (
        <section style={panelStyle} aria-label="Backlog compartilhado de pautas">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <div>
                    <h2 style={{ fontSize: '16px', color: '#0f172a', margin: 0 }}>Backlog de pautas</h2>
                    <p style={{ fontSize: '12px', color: '#64748b', margin: '3px 0 0' }}>Links entram aqui sem iniciar IA, render ou publicação.</p>
                </div>
                <button type="button" className="ap-btn-refresh" onClick={load} disabled={loading || !clienteId}><RefreshCcw size={14} className={loading ? 'ap-spin-icon' : ''} /> Atualizar</button>
            </div>
            <form onSubmit={add} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 2fr) minmax(120px, 1fr) minmax(120px, 1fr) auto', gap: '8px' }}>
                <input value={url} onChange={e => setUrl(e.target.value)} required type="url" placeholder="https://link-da-pauta" aria-label="Link da pauta" />
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Título (opcional)" aria-label="Título da pauta" />
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Observação (opcional)" aria-label="Observação da pauta" />
                <button className="ap-btn-refresh primary" disabled={submitting || !clienteId} type="submit">{submitting ? <Loader2 size={14} className="ap-spin-icon" /> : <Plus size={14} />} Adicionar</button>
            </form>
            {error && <div role="alert" style={{ color: '#b91c1c', fontSize: '13px' }}>{error}</div>}
            {loading ? <div style={{ color: '#64748b', fontSize: '13px' }}>Carregando pautas…</div> : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '14px' }}>
                    {[
                        ['Disponíveis', groups.available],
                        ['Minhas pautas', groups.mine],
                        ['Adotadas por outros', groups.others],
                    ].map(([label, group]) => <div key={label} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0 12px' }}>
                        <h3 style={{ color: '#334155', fontSize: '13px', margin: '12px 0 0' }}>{label} <span style={{ color: '#94a3b8' }}>({group.length})</span></h3>
                        <ul style={{ padding: 0, margin: 0 }}>{group.map(renderItem)}</ul>
                    </div>)}
                </div>
            )}
        </section>
    )
}
