import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import '../../styles/AutoPublisher.css'
import { Rss, CheckCircle2, XCircle, Clock, Settings, ListVideo, History } from 'lucide-react'
import AutoPublisherSettings from './AutoPublisherSettings'

// ──────────────────────────────────────────────────────────
// AutoPublisher — Main Page
// Tabs: Review Queue | Published | Settings
// ──────────────────────────────────────────────────────────

const TABS = ['review', 'published', 'settings']
const TAB_LABELS = { review: 'Fila de Revisão', published: 'Publicados', settings: 'Configurações' }
const TAB_ICONS = { review: ListVideo, published: History, settings: Settings }

export default function AutoPublisher() {
    const { professionalId } = useAuth()
    const [clienteId, setClienteId] = useState(null)

    // Fetch the cliente_id for the current professional
    useEffect(() => {
        if (!professionalId) return
        supabase
            .from('cliente_profissionais')
            .select('cliente_id')
            .eq('profissional_id', professionalId)
            .eq('ativo', true)
            .limit(1)
            .single()
            .then(({ data }) => {
                if (data) setClienteId(data.cliente_id)
            })
    }, [professionalId])

    const [tab, setTab] = useState('review')
    const [reviewItems, setReviewItems] = useState([])
    const [publishedItems, setPublishedItems] = useState([])
    const [loading, setLoading] = useState(false)

    const fetchReview = useCallback(async () => {
        if (!clienteId) return
        setLoading(true)
        const { data } = await supabase
            .from('ap.candidate_news')
            .select('id, titulo, headline, caption, render_url, imagem_url, status, posicao_feed, horario_agendado, created_at')
            .eq('cliente_id', clienteId)
            .in('status', ['pending_review', 'approved', 'queued_for_posting'])
            .order('posicao_feed', { ascending: true })
        setReviewItems(data ?? [])
        setLoading(false)
    }, [clienteId])

    const fetchPublished = useCallback(async () => {
        if (!clienteId) return
        setLoading(true)
        const { data } = await supabase
            .from('ap.candidate_news')
            .select('id, titulo, headline, caption, render_url, instagram_post_id, horario_agendado, status')
            .eq('cliente_id', clienteId)
            .in('status', ['posted', 'rejected'])
            .order('horario_agendado', { ascending: false })
            .limit(30)
        setPublishedItems(data ?? [])
        setLoading(false)
    }, [clienteId])

    useEffect(() => {
        if (tab === 'review') fetchReview()
        if (tab === 'published') fetchPublished()
    }, [tab, fetchReview, fetchPublished])

    async function handleApprove(item) {
        if (item.status !== 'pending_review') return
        // Mark as approved first
        await supabase
            .from('ap.candidate_news')
            .update({ status: 'approved' })
            .eq('id', item.id)
            .eq('status', 'pending_review')

        // Call scheduler to assign a slot
        const { data: { session } } = await supabase.auth.getSession()
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ap-scheduler`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session?.access_token}`,
            },
            body: JSON.stringify({ news_id: item.id }),
        })

        // Log editorial action for learning engine
        await supabase.from('ap.learning_history').insert({
            cliente_id: clienteId,
            news_id: item.id,
            categoria: item.categoria,
            fonte_id: item.fonte_id,
            acao: 'approved',
            score_delta: 1,
        })

        fetchReview()
    }

    async function handleReject(item) {
        await supabase
            .from('ap.candidate_news')
            .update({ status: 'rejected' })
            .eq('id', item.id)

        await supabase.from('ap.learning_history').insert({
            cliente_id: clienteId,
            news_id: item.id,
            categoria: item.categoria,
            fonte_id: item.fonte_id,
            acao: 'rejected',
            score_delta: -1,
        })

        fetchReview()
    }

    return (
        <div className="ap-page">
            {/* Header */}
            <div className="ap-header">
                <Rss size={24} color="#0ea5e9" />
                <h1>AutoPublisher</h1>
                <span className="ap-badge">V1</span>
            </div>

            {/* Tabs */}
            <div className="ap-tabs">
                {TABS.map((t) => {
                    const Icon = TAB_ICONS[t]
                    return (
                        <button
                            key={t}
                            className={`ap-tab${tab === t ? ' active' : ''}`}
                            onClick={() => setTab(t)}
                        >
                            <Icon size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                            {TAB_LABELS[t]}
                        </button>
                    )
                })}
            </div>

            {/* Content */}
            {tab === 'review' && (
                <ReviewTab items={reviewItems} loading={loading} onApprove={handleApprove} onReject={handleReject} />
            )}
            {tab === 'published' && (
                <PublishedTab items={publishedItems} loading={loading} />
            )}
            {tab === 'settings' && (
                <AutoPublisherSettings clienteId={clienteId} />
            )}
        </div>
    )
}

// ── Review Queue Tab ──────────────────────────────────────

function ReviewTab({ items, loading, onApprove, onReject }) {
    if (loading) return <div className="ap-loading"><Rss size={16} />Carregando...</div>
    if (!items.length) {
        return (
            <div className="ap-empty">
                <CheckCircle2 />
                <p>Nenhuma notícia aguardando revisão no momento.</p>
            </div>
        )
    }

    return (
        <div className="ap-grid">
            {items.map((item) => (
                <div key={item.id} className="ap-card">
                    {(item.render_url || item.imagem_url) && (
                        <img
                            className="ap-card-image"
                            src={item.render_url ?? item.imagem_url}
                            alt={item.titulo}
                            loading="lazy"
                        />
                    )}
                    <div className="ap-card-meta">
                        <span className={`ap-status ${item.status}`}>{item.status.replace(/_/g, ' ')}</span>
                        {item.horario_agendado && (
                            <span className="ap-schedule-time">
                                <Clock size={11} style={{ marginRight: 3, verticalAlign: 'middle' }} />
                                {new Date(item.horario_agendado).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        )}
                    </div>
                    <p className="ap-card-headline">{item.headline ?? item.titulo}</p>
                    {item.caption && (
                        <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0, lineHeight: 1.4 }}>
                            {item.caption.slice(0, 100)}…
                        </p>
                    )}
                    {item.status === 'pending_review' && (
                        <div className="ap-card-actions">
                            <button className="ap-btn primary" onClick={() => onApprove(item)}>
                                <CheckCircle2 size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                Aprovar
                            </button>
                            <button className="ap-btn danger" onClick={() => onReject(item)}>
                                <XCircle size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                Rejeitar
                            </button>
                        </div>
                    )}
                </div>
            ))}
        </div>
    )
}

// ── Published Tab ─────────────────────────────────────────

function PublishedTab({ items, loading }) {
    if (loading) return <div className="ap-loading"><Rss size={16} />Carregando...</div>
    if (!items.length) {
        return (
            <div className="ap-empty">
                <History />
                <p>Nenhuma publicação encontrada.</p>
            </div>
        )
    }

    return (
        <div className="ap-grid">
            {items.map((item) => (
                <div key={item.id} className="ap-card">
                    {item.render_url && (
                        <img className="ap-card-image" src={item.render_url} alt={item.titulo} loading="lazy" />
                    )}
                    <div className="ap-card-meta">
                        <span className={`ap-status ${item.status}`}>{item.status}</span>
                        {item.horario_agendado && (
                            <span className="ap-schedule-time">
                                {new Date(item.horario_agendado).toLocaleDateString('pt-BR')}
                            </span>
                        )}
                    </div>
                    <p className="ap-card-headline">{item.headline ?? item.titulo}</p>
                    {item.instagram_post_id && (
                        <a
                            href={`https://www.instagram.com/p/${item.instagram_post_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ap-btn ghost"
                            style={{ textAlign: 'center', textDecoration: 'none' }}
                        >
                            Ver no Instagram →
                        </a>
                    )}
                </div>
            ))}
        </div>
    )
}
