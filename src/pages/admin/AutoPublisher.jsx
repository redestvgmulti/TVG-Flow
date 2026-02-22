import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import '../../styles/AutoPublisher.css'
import {
    Rss, RefreshCcw, Check, X, Pencil,
    ImageIcon, Clock, Zap, Info, Filter, MoreVertical
} from 'lucide-react'
import AutoPublisherSettings from './AutoPublisherSettings'

// ──────────────────────────────────────────────────────────
// Pipeline stage config (FlowOS V2 Standard)
// ──────────────────────────────────────────────────────────
const STAGES = [
    { key: 'raw', label: 'Ingerido' },
    { key: 'scored', label: 'Analisado' },
    { key: 'selected', label: 'Selecionado' },
    { key: 'pending_render', label: 'Em Renderização' },
    { key: 'pending_review', label: 'Revisão Editorial' },
    { key: 'queued_for_posting', label: 'Agendado' },
    { key: 'posted', label: 'Publicado' },
]

// ──────────────────────────────────────────────────────────
// Main Page — Newsroom Control Center (V2)
// ──────────────────────────────────────────────────────────
export default function AutoPublisher() {
    const { professionalId } = useAuth()
    const [clienteId, setClienteId] = useState(null)

    useEffect(() => {
        if (!professionalId) return
        supabase
            .from('cliente_profissionais')
            .select('cliente_id')
            .eq('profissional_id', professionalId)
            .eq('ativo', true)
            .limit(1)
            .single()
            .then(({ data }) => { if (data) setClienteId(data.cliente_id) })
    }, [professionalId])

    const [tab, setTab] = useState('review')
    const [stageFilter, setStageFilter] = useState(null)
    const [stageCounts, setStageCounts] = useState({})
    const [reviewItems, setReviewItems] = useState([])
    const [publishedItems, setPublishedItems] = useState([])
    const [loading, setLoading] = useState(false)
    const [metrics, setMetrics] = useState({ ingeridas: 0, processadas: 0, revisao: 0, agendadas: 0, publicadas: 0 })

    const fetchCounts = useCallback(async () => {
        if (!clienteId) return
        const { data } = await supabase.from('ap.candidate_news').select('status').eq('cliente_id', clienteId)

        const counts = {}
        for (const row of data ?? []) {
            counts[row.status] = (counts[row.status] ?? 0) + 1
        }
        setStageCounts(counts)

        const today = new Date(); today.setHours(0, 0, 0, 0)
        const { count: ingeridas } = await supabase
            .from('ap.candidate_news')
            .select('id', { count: 'exact', head: true })
            .eq('cliente_id', clienteId)
            .gte('created_at', today.toISOString())

        setMetrics({
            ingeridas: ingeridas ?? 0,
            processadas: (counts['scored'] ?? 0) + (counts['selected'] ?? 0),
            revisao: counts['pending_review'] ?? 0,
            agendadas: counts['queued_for_posting'] ?? 0,
            publicadas: counts['posted'] ?? 0,
        })
    }, [clienteId])

    const fetchReview = useCallback(async () => {
        if (!clienteId) return
        setLoading(true)
        const { data } = await supabase
            .from('ap.candidate_news')
            .select(`
        id, titulo, headline, caption, render_url, imagem_url,
        status, posicao_feed, horario_agendado, created_at,
        categoria, fonte_id, visual_energy_level,
        ap_candidate_scores(score_total)
      `)
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
        if (!clienteId) return
        fetchCounts()
        if (tab === 'review') fetchReview()
        if (tab === 'published') fetchPublished()
    }, [clienteId, tab, fetchCounts, fetchReview, fetchPublished])

    async function handleApprove(item) {
        if (item.status !== 'pending_review') return
        await supabase.from('ap.candidate_news').update({ status: 'approved' }).eq('id', item.id)

        // Fire & forget scheduler
        supabase.auth.getSession().then(({ data: { session } }) => {
            fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ap-scheduler`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
                body: JSON.stringify({ news_id: item.id }),
            })
        })

        await supabase.from('ap.learning_history').insert({
            cliente_id: clienteId, news_id: item.id, categoria: item.categoria, fonte_id: item.fonte_id, acao: 'approved', score_delta: 1,
        })
        fetchReview(); fetchCounts()
    }

    async function handleReject(item) {
        await supabase.from('ap.candidate_news').update({ status: 'rejected' }).eq('id', item.id)
        await supabase.from('ap.learning_history').insert({
            cliente_id: clienteId, news_id: item.id, categoria: item.categoria, fonte_id: item.fonte_id, acao: 'rejected', score_delta: -1,
        })
        fetchReview(); fetchCounts()
    }

    const displayedReview = stageFilter ? reviewItems.filter(i => i.status === stageFilter) : reviewItems

    return (
        <div className="ap-page">
            <div className="ap-main">
                {/* ── Page Header ─────────────────────────── */}
                <div className="ap-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Rss size={20} style={{ color: 'var(--color-primary)' }} />
                        <h1 className="ap-header-title">AutoPublisher</h1>
                        <span className="ap-badge-live">Pipeline Ativo</span>
                    </div>
                    <button className="ap-btn-edit" onClick={() => { fetchCounts(); if (tab === 'review') fetchReview(); else fetchPublished(); }}>
                        <RefreshCcw size={14} /> Atualizar
                    </button>
                </div>

                {/* ── Metric Cards ─────────────────────────── */}
                <div className="ap-metrics">
                    {[
                        { label: 'Ingeridas Hoje', val: metrics.ingeridas },
                        { label: 'Processadas', val: metrics.processadas },
                        { label: 'Em Revisão', val: metrics.revisao },
                        { label: 'Agendadas', val: metrics.agendadas },
                        { label: 'Publicadas', val: metrics.publicadas },
                    ].map((m, i) => (
                        <div key={i} className="ap-metric-card">
                            <span className="ap-metric-value">{m.val}</span>
                            <span className="ap-metric-label">{m.label}</span>
                        </div>
                    ))}
                </div>

                {/* ── Pipeline Visual ──────────────────────── */}
                <div className="ap-pipeline">
                    {STAGES.map(({ key, label }) => (
                        <button
                            key={key}
                            className={`ap-stage${stageFilter === key ? ' active' : ''}`}
                            onClick={() => setStageFilter(p => p === key ? null : key)}
                        >
                            <span className="ap-stage-count">{stageCounts[key] ?? 0}</span>
                            <span className="ap-stage-label">{label}</span>
                        </button>
                    ))}
                </div>

                {/* ── Tabs ─────────────────────────────────── */}
                <div className="ap-tabs">
                    {[
                        ['review', 'Fila de Revisão'],
                        ['published', 'Publicados'],
                        ['settings', 'Configurações']
                    ].map(([key, label]) => (
                        <button key={key} className={`ap-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* ── Content Area ─────────────────────────── */}
                {tab === 'review' && (
                    loading ? <LoadingState /> : displayedReview.length === 0 ? <EmptyStatePremium /> : (
                        <div className="ap-cards-grid">
                            {displayedReview.map(item => (
                                <ReviewCard key={item.id} item={item} onApprove={handleApprove} onReject={handleReject} />
                            ))}
                        </div>
                    )
                )}

                {tab === 'published' && (
                    loading ? <LoadingState /> : publishedItems.length === 0 ? <EmptyStatePremium /> : (
                        <table className="ap-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '120px' }}>Imagem</th>
                                    <th>Notícia</th>
                                    <th style={{ width: '150px' }}>Status</th>
                                    <th style={{ width: '150px' }}>Data</th>
                                    <th style={{ width: '80px', textAlign: 'center' }}><MoreVertical size={14} /></th>
                                </tr>
                            </thead>
                            <tbody>
                                {publishedItems.map(item => (
                                    <tr key={item.id}>
                                        <td>
                                            {item.render_url ? (
                                                <div style={{ width: 100, height: 56, borderRadius: 4, overflow: 'hidden', background: 'var(--color-bg-secondary)' }}>
                                                    <img src={item.render_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} lazy="true" />
                                                </div>
                                            ) : <span style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>Sem Imagem</span>}
                                        </td>
                                        <td>
                                            <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{item.headline ?? item.titulo}</div>
                                            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                                                {item.caption ? (item.caption.length > 80 ? item.caption.slice(0, 80) + '...' : item.caption) : '—'}
                                            </div>
                                        </td>
                                        <td><span className={`ap-status ${item.status}`}>{item.status}</span></td>
                                        <td style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                            {item.horario_agendado ? new Date(item.horario_agendado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            {item.instagram_post_id && (
                                                <a href={`https://www.instagram.com/p/${item.instagram_post_id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)' }}>
                                                    <Rss size={14} />
                                                </a>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
                )}

                {tab === 'settings' && <AutoPublisherSettings clienteId={clienteId} />}
            </div>
        </div>
    )
}

// ──────────────────────────────────────────────────────────
// Components
// ──────────────────────────────────────────────────────────
function ReviewCard({ item, onApprove, onReject }) {
    const rawScore = item.ap_candidate_scores?.score_total
    const score = rawScore != null ? Math.round(rawScore * 10) : null

    return (
        <div className="ap-review-card">
            <div className="ap-card-score-bar">
                <div>
                    <span className="ap-score-value">{score ?? '—'}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginLeft: 8, textTransform: 'uppercase' }}>Score</span>
                </div>
                {score != null && (
                    <span className="ap-confidence">
                        Confiança: <strong style={{ color: 'var(--color-text-primary)', marginLeft: 4 }}>{score > 80 ? 'Alta' : score > 50 ? 'Média' : 'Baixa'}</strong>
                    </span>
                )}
            </div>

            <div className="ap-card-img-wrap">
                {item.render_url || item.imagem_url ? (
                    <img className="ap-card-img" src={item.render_url ?? item.imagem_url} alt="" loading="lazy" />
                ) : (
                    <div className="ap-card-img-placeholder"><ImageIcon size={24} /></div>
                )}
                <span className="ap-card-energy">
                    Energia: {item.visual_energy_level === 'high' ? 'Alta' : item.visual_energy_level === 'medium' ? 'Média' : 'Baixa'}
                </span>
            </div>

            <div className="ap-card-body">
                <p className="ap-card-headline">{item.headline ?? item.titulo}</p>
                {item.caption && <p className="ap-card-caption">{item.caption}</p>}

                <div className="ap-card-tags">
                    {item.categoria && <span className="ap-tag">{item.categoria}</span>}
                    {item.status !== 'pending_review' && <span className="ap-tag">{item.status.replace(/_/g, ' ')}</span>}
                    {item.horario_agendado && (
                        <span className="ap-tag" style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', borderColor: 'transparent' }}>
                            <Clock size={10} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                            {new Date(item.horario_agendado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                    )}
                </div>
            </div>

            {item.status === 'pending_review' && (
                <div className="ap-card-actions">
                    <button className="ap-btn-reject" onClick={() => onReject(item)} title="Rejeitar">
                        <X size={14} />
                    </button>
                    <button className="ap-btn-edit" onClick={() => { }} title="Editar Texto">
                        <Pencil size={13} />
                    </button>
                    <button className="ap-btn-approve" onClick={() => onApprove(item)}>
                        Aprovar <Check size={14} style={{ marginLeft: 4 }} />
                    </button>
                </div>
            )}
        </div>
    )
}

function EmptyStatePremium() {
    return (
        <div className="ap-empty">
            <div className="ap-empty-icon"><Info size={20} /></div>
            <p className="ap-empty-title">Sistema Operacional</p>
            <p className="ap-empty-sub">Nenhum registro encontrado para esta visualização.</p>
        </div>
    )
}

function LoadingState() {
    return (
        <div className="ap-loading">
            <div className="ap-spinner" />
            <span>Carregando...</span>
        </div>
    )
}
