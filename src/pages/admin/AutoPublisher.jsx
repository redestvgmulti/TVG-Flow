import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import '../../styles/AutoPublisher.css'
import {
    Rss, CheckCircle2, XCircle, Pencil, Layers, Clock,
    Image as ImageIcon, ListVideo, History, Settings,
    TrendingUp, CalendarClock, Eye, Zap,
} from 'lucide-react'
import AutoPublisherSettings from './AutoPublisherSettings'

// ──────────────────────────────────────────────────────────
// Pipeline stage config
// ──────────────────────────────────────────────────────────
const STAGES = [
    { key: 'raw', label: 'RAW', icon: '📥' },
    { key: 'scored', label: 'SCORED', icon: '🧠' },
    { key: 'selected', label: 'SEL.', icon: '🎯' },
    { key: 'pending_render', label: 'RENDER', icon: '🎨' },
    { key: 'pending_review', label: 'REVIEW', icon: '👁' },
    { key: 'queued_for_posting', label: 'SCHED.', icon: '📅' },
    { key: 'posted', label: 'POSTED', icon: '✅' },
]

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────
function scoreEmoji(score) {
    if (score >= 90) return '🔥'
    if (score >= 75) return '⚡'
    if (score >= 55) return '📈'
    return '❄️'
}

function confidenceLabel(score) {
    if (score >= 80) return 'Alta'
    if (score >= 55) return 'Média'
    return 'Baixa'
}

function confidenceClass(score) {
    if (score >= 80) return 'alta'
    if (score >= 55) return 'media'
    return 'baixa'
}

function timeAgo(ts) {
    if (!ts) return '—'
    const diff = Math.floor((Date.now() - new Date(ts)) / 60000)
    if (diff < 1) return 'agora'
    if (diff < 60) return `${diff}m atrás`
    return `${Math.floor(diff / 60)}h atrás`
}

// ──────────────────────────────────────────────────────────
// Main Page
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
    const [activity, setActivity] = useState([])
    const [loading, setLoading] = useState(false)
    const [metrics, setMetrics] = useState({ ingeridas: 0, processadas: 0, revisao: 0, agendadas: 0, publicadas: 0 })

    // Fetch stage counts for pipeline
    const fetchCounts = useCallback(async () => {
        if (!clienteId) return
        const { data } = await supabase
            .from('ap.candidate_news')
            .select('status')
            .eq('cliente_id', clienteId)

        const counts = {}
        for (const row of data ?? []) {
            counts[row.status] = (counts[row.status] ?? 0) + 1
        }
        setStageCounts(counts)

        // Today's ingest
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

    const fetchActivity = useCallback(async () => {
        if (!clienteId) return
        const { data } = await supabase
            .from('ap.candidate_news')
            .select('id, titulo, status, updated_at')
            .eq('cliente_id', clienteId)
            .in('status', ['posted', 'pending_review', 'pending_render', 'scored'])
            .order('updated_at', { ascending: false })
            .limit(12)
        setActivity(data ?? [])
    }, [clienteId])

    useEffect(() => {
        if (!clienteId) return
        fetchCounts()
        fetchActivity()
        if (tab === 'review') fetchReview()
        if (tab === 'published') fetchPublished()
    }, [clienteId, tab, fetchCounts, fetchReview, fetchPublished, fetchActivity])

    async function handleApprove(item) {
        if (item.status !== 'pending_review') return
        await supabase
            .from('ap.candidate_news')
            .update({ status: 'approved' })
            .eq('id', item.id)
            .eq('status', 'pending_review')

        const { data: { session } } = await supabase.auth.getSession()
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ap-scheduler`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
            body: JSON.stringify({ news_id: item.id }),
        })

        await supabase.from('ap.learning_history').insert({
            cliente_id: clienteId, news_id: item.id,
            categoria: item.categoria, fonte_id: item.fonte_id,
            acao: 'approved', score_delta: 1,
        })

        fetchReview(); fetchCounts()
    }

    async function handleReject(item) {
        await supabase.from('ap.candidate_news').update({ status: 'rejected' }).eq('id', item.id)
        await supabase.from('ap.learning_history').insert({
            cliente_id: clienteId, news_id: item.id,
            categoria: item.categoria, fonte_id: item.fonte_id,
            acao: 'rejected', score_delta: -1,
        })
        fetchReview(); fetchCounts()
    }

    const displayedReview = stageFilter
        ? reviewItems.filter(i => i.status === stageFilter)
        : reviewItems

    return (
        <div className="ap-page">
            {/* ── Main content ─────────────────────────── */}
            <div className="ap-main">
                <PipelineHeader />

                <MetricCards metrics={metrics} />

                <PipelineStages
                    stages={STAGES}
                    counts={stageCounts}
                    activeStage={stageFilter}
                    onStageClick={(key) => setStageFilter(prev => prev === key ? null : key)}
                />

                {/* Tabs */}
                <div className="ap-tabs">
                    {[['review', <ListVideo size={13} />, 'Fila de Revisão'],
                    ['published', <History size={13} />, 'Publicados'],
                    ['settings', <Settings size={13} />, 'Configurações']].map(([key, icon, label]) => (
                        <button
                            key={key}
                            className={`ap-tab${tab === key ? ' active' : ''}`}
                            onClick={() => setTab(key)}
                        >
                            {icon} {label}
                        </button>
                    ))}
                </div>

                <AnimatePresence mode="wait">
                    {tab === 'review' && (
                        <motion.div key="review"
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.18 }}
                        >
                            {loading
                                ? <LoadingState />
                                : displayedReview.length === 0
                                    ? <EmptyStatePremium />
                                    : <div className="ap-cards-grid">
                                        <AnimatePresence>
                                            {displayedReview.map((item, i) => (
                                                <ReviewCard
                                                    key={item.id}
                                                    item={item}
                                                    index={i}
                                                    onApprove={handleApprove}
                                                    onReject={handleReject}
                                                />
                                            ))}
                                        </AnimatePresence>
                                    </div>
                            }
                        </motion.div>
                    )}

                    {tab === 'published' && (
                        <motion.div key="published"
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.18 }}
                        >
                            {loading
                                ? <LoadingState />
                                : <div className="ap-cards-grid">
                                    {publishedItems.map(item => (
                                        <div key={item.id} className="ap-published-card">
                                            {item.render_url && (
                                                <img className="ap-published-img" src={item.render_url} alt="" loading="lazy" />
                                            )}
                                            <div className="ap-published-body">
                                                <span className={`ap-status ${item.status}`}>{item.status}</span>
                                                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#e2e8f0' }}>
                                                    {item.headline ?? item.titulo}
                                                </p>
                                                {item.horario_agendado && (
                                                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#334155' }}>
                                                        {new Date(item.horario_agendado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                                                    </p>
                                                )}
                                                {item.instagram_post_id && (
                                                    <a
                                                        href={`https://www.instagram.com/p/${item.instagram_post_id}`}
                                                        target="_blank" rel="noopener noreferrer"
                                                        className="ap-ig-link"
                                                    >
                                                        Ver no Instagram →
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            }
                        </motion.div>
                    )}

                    {tab === 'settings' && (
                        <motion.div key="settings"
                            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            transition={{ duration: 0.18 }}
                        >
                            <AutoPublisherSettings clienteId={clienteId} />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* ── Sidebar ───────────────────────────────── */}
            <ActivityPanel items={activity} />
        </div>
    )
}

// ──────────────────────────────────────────────────────────
// PipelineHeader
// ──────────────────────────────────────────────────────────
function PipelineHeader() {
    return (
        <div className="ap-header">
            <Rss size={20} color="#0ea5e9" />
            <h1 className="ap-header-title">AutoPublisher</h1>
            <span className="ap-badge-live">Pipeline Ativo</span>
        </div>
    )
}

// ──────────────────────────────────────────────────────────
// MetricCards
// ──────────────────────────────────────────────────────────
const METRIC_DEFS = [
    { key: 'ingeridas', label: 'Ingeridas hoje', icon: '📥' },
    { key: 'processadas', label: 'Processadas', icon: '🧠' },
    { key: 'revisao', label: 'Em revisão', icon: '🕒' },
    { key: 'agendadas', label: 'Agendadas', icon: '📅' },
    { key: 'publicadas', label: 'Publicadas', icon: '✅' },
]

function MetricCards({ metrics }) {
    return (
        <div className="ap-metrics">
            {METRIC_DEFS.map(({ key, label, icon }) => (
                <motion.div
                    key={key}
                    className="ap-metric-card"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: METRIC_DEFS.findIndex(m => m.key === key) * 0.05 }}
                >
                    <span className="ap-metric-icon">{icon}</span>
                    <span className="ap-metric-value">{metrics[key] ?? 0}</span>
                    <span className="ap-metric-label">{label}</span>
                </motion.div>
            ))}
        </div>
    )
}

// ──────────────────────────────────────────────────────────
// PipelineStages
// ──────────────────────────────────────────────────────────
function PipelineStages({ stages, counts, activeStage, onStageClick }) {
    return (
        <div className="ap-pipeline">
            {stages.map(({ key, label, icon }) => (
                <button
                    key={key}
                    className={`ap-stage${activeStage === key ? ' active' : ''}`}
                    data-stage={key}
                    onClick={() => onStageClick(key)}
                    title={`Filtrar: ${label}`}
                >
                    <div className="ap-stage-dot" />
                    <span className="ap-stage-count">{counts[key] ?? 0}</span>
                    <span className="ap-stage-label">{icon} {label}</span>
                </button>
            ))}
        </div>
    )
}

// ──────────────────────────────────────────────────────────
// ReviewCard
// ──────────────────────────────────────────────────────────
function ReviewCard({ item, index, onApprove, onReject }) {
    const rawScore = item.ap_candidate_scores?.score_total
    const score = rawScore != null ? Math.round(rawScore * 10) : null
    const displayScore = score ?? '—'
    const energy = item.visual_energy_level ?? 'medium'

    return (
        <motion.div
            className="ap-review-card"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.22, delay: Math.min(index * 0.04, 0.3) }}
            layout
        >
            {/* Score + Confidence */}
            <div className="ap-card-score-bar">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.25rem' }}>
                    <span className="ap-score-value">{displayScore}</span>
                    {score != null && <span className="ap-score-emoji">{scoreEmoji(score)}</span>}
                </div>
                {score != null && (
                    <span className={`ap-confidence ${confidenceClass(score)}`}>
                        <Zap size={10} />
                        {confidenceLabel(score)}
                    </span>
                )}
            </div>

            {/* Image */}
            <div className="ap-card-img-wrap">
                {item.render_url || item.imagem_url ? (
                    <img
                        className="ap-card-img"
                        src={item.render_url ?? item.imagem_url}
                        alt={item.titulo}
                        loading="lazy"
                    />
                ) : (
                    <div className="ap-card-img-placeholder">
                        <ImageIcon size={28} />
                    </div>
                )}
                <span className={`ap-card-energy ${energy}`}>
                    {energy === 'high' ? '🔴 Alta' : energy === 'medium' ? '🟡 Média' : '🔵 Baixa'}
                </span>
            </div>

            {/* Body */}
            <div className="ap-card-body">
                <p className="ap-card-headline">{item.headline ?? item.titulo}</p>
                {item.caption && <p className="ap-card-caption">{item.caption}</p>}

                <div className="ap-card-tags">
                    {item.categoria && <span className="ap-tag">{item.categoria}</span>}
                    {item.status !== 'pending_review' && (
                        <span className="ap-tag" style={{ color: '#0ea5e9' }}>{item.status.replace(/_/g, ' ')}</span>
                    )}
                    {item.horario_agendado && (
                        <span className="ap-tag" style={{ color: '#fbbf24' }}>
                            <Clock size={9} style={{ marginRight: 2, verticalAlign: 'middle' }} />
                            {new Date(item.horario_agendado).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    )}
                </div>
            </div>

            {/* Actions */}
            {item.status === 'pending_review' && (
                <div className="ap-card-actions">
                    <button className="ap-btn-approve" onClick={() => onApprove(item)}>
                        <CheckCircle2 size={14} /> Aprovar
                    </button>
                    <button className="ap-btn-edit" onClick={() => { }}>
                        <Pencil size={13} />
                    </button>
                    <button className="ap-btn-reject" onClick={() => onReject(item)}>
                        <XCircle size={13} />
                    </button>
                </div>
            )}
        </motion.div>
    )
}

// ──────────────────────────────────────────────────────────
// EmptyStatePremium
// ──────────────────────────────────────────────────────────
function EmptyStatePremium() {
    return (
        <motion.div
            className="ap-empty"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
        >
            <div className="ap-empty-icon">
                <Eye size={28} />
            </div>
            <p className="ap-empty-title">🤖 Sistema ativo</p>
            <p className="ap-empty-sub">Nenhuma notícia aguardando revisão no momento.</p>
            <p className="ap-empty-sub" style={{ color: '#1e293b', fontSize: '0.78rem' }}>
                O pipeline está processando automaticamente.
            </p>
        </motion.div>
    )
}

// ──────────────────────────────────────────────────────────
// ActivityPanel (Sidebar)
// ──────────────────────────────────────────────────────────
const ACTIVITY_TYPE = {
    posted: { icon: '✅', bg: 'rgba(34,197,94,0.1)', label: 'Publicado' },
    pending_review: { icon: '👁', bg: 'rgba(251,191,36,0.1)', label: 'Em revisão' },
    pending_render: { icon: '🎨', bg: 'rgba(249,115,22,0.1)', label: 'Render concluído' },
    scored: { icon: '🧠', bg: 'rgba(168,85,247,0.1)', label: 'Score calculado' },
}

function ActivityPanel({ items }) {
    return (
        <div className="ap-sidebar">
            <p className="ap-sidebar-title">
                <TrendingUp size={11} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                Atividade Recente
            </p>

            <div className="ap-activity-list">
                {items.length === 0 && (
                    <p style={{ fontSize: '0.78rem', color: '#1e293b', textAlign: 'center', padding: '2rem 0' }}>
                        Sem atividade recente.
                    </p>
                )}
                {items.map((item, i) => {
                    const type = ACTIVITY_TYPE[item.status] ?? { icon: '📌', bg: 'rgba(255,255,255,0.05)', label: item.status }
                    return (
                        <motion.div
                            key={item.id}
                            className="ap-activity-item"
                            initial={{ opacity: 0, x: 8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.03, duration: 0.2 }}
                        >
                            <div className="ap-activity-icon" style={{ background: type.bg }}>
                                {type.icon}
                            </div>
                            <div className="ap-activity-content">
                                <p className="ap-activity-text">
                                    <strong style={{ color: '#64748b' }}>{type.label}</strong>
                                    {' — '}
                                    {(item.titulo ?? '').slice(0, 48)}{(item.titulo?.length ?? 0) > 48 ? '…' : ''}
                                </p>
                                <span className="ap-activity-time">{timeAgo(item.updated_at)}</span>
                            </div>
                        </motion.div>
                    )
                })}
            </div>
        </div>
    )
}

// ──────────────────────────────────────────────────────────
// LoadingState
// ──────────────────────────────────────────────────────────
function LoadingState() {
    return (
        <div className="ap-loading">
            <div className="ap-spinner" />
            <span>Carregando pipeline...</span>
        </div>
    )
}
