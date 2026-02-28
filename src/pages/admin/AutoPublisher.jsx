import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../services/supabase'
import '../../styles/AutoPublisher.css'
import {
    Rss, RefreshCcw, Check, X, Pencil, Copy, Download,
    ImageIcon, Clock, Zap, Info, Filter, MoreVertical, Brain, Heart, MessageCircle, Send, Bookmark, Plus, UploadCloud
} from 'lucide-react'
import AutoPublisherSettings from './AutoPublisherSettings'
import EditorialEngine from '../../features/editorial/EditorialEngine'
import { SkeletonCard, SkeletonTable } from '../../components/Skeleton'

const FIXED_CLIENT_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'

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
    const clienteId = FIXED_CLIENT_ID


    const [tab, setTab] = useState('review')
    const [stageFilter, setStageFilter] = useState(null)
    const [stageCounts, setStageCounts] = useState({})
    const [reviewItems, setReviewItems] = useState([])
    const [publishedItems, setPublishedItems] = useState([])
    const [loading, setLoading] = useState(false)
    const [metrics, setMetrics] = useState({ ingeridas: 0, processadas: 0, revisao: 0, agendadas: 0, publicadas: 0 })
    const [ingestionEnabled, setIngestionEnabled] = useState(true)
    const [isProcessing, setIsProcessing] = useState(false)

    // Manual Input State
    const [isManualModalOpen, setManualModalOpen] = useState(false)
    const [manualForm, setManualForm] = useState({ titulo: '', conteudo: '', imagem_url: '', context_tag: '' })
    const [isSubmittingManual, setIsSubmittingManual] = useState(false)
    const [selectedFile, setSelectedFile] = useState(null)
    const [isDragging, setIsDragging] = useState(false)

    const fetchSystemConfig = useCallback(async () => {
        if (!clienteId) return
        const { data, error } = await supabase.schema('ap').from('system_config').select('ingestion_enabled').eq('cliente_id', clienteId).single()
        if (data) setIngestionEnabled(data.ingestion_enabled)
    }, [clienteId])

    async function toggleIngestion() {
        const newVal = !ingestionEnabled
        setIngestionEnabled(newVal)
        await supabase.schema('ap').from('system_config').upsert({ cliente_id: clienteId, ingestion_enabled: newVal })
    }

    const fetchCounts = useCallback(async () => {
        if (!clienteId) return
        const { data, error } = await supabase.from('ap_candidate_news').select('id, status, created_at').eq('cliente_id', clienteId)
        if (error) console.error('[AutoPublisher] fetchCounts error:', error)

        const counts = {}
        for (const row of data ?? []) {
            counts[row.status] = (counts[row.status] ?? 0) + 1
        }
        setStageCounts(counts)

        const today = new Date(); today.setHours(0, 0, 0, 0)
        let ingeridasCount = 0
        for (const row of data ?? []) {
            if (new Date(row.created_at) >= today) ingeridasCount++
        }

        setMetrics({
            ingeridas: ingeridasCount,
            processadas: (counts['scored'] ?? 0) + (counts['selected'] ?? 0),
            revisao: counts['pending_review'] ?? 0,
            agendadas: counts['queued_for_posting'] ?? 0,
            publicadas: counts['posted'] ?? 0,
        })
    }, [clienteId])

    const fetchReview = useCallback(async () => {
        if (!clienteId) return
        setLoading(true)
        const { data, error } = await supabase
            .from('ap_candidate_news_complete')
            .select(`
        id, titulo, headline, caption, render_url, imagem_url,
        status, posicao_feed, horario_agendado, created_at,
        categoria, fonte_id, visual_energy_level, context_tag
      `)
            .eq('cliente_id', clienteId)
            .in('status', ['raw', 'scored', 'selected', 'pending_render', 'pending_review', 'approved', 'queued_for_posting'])
            .order('posicao_feed', { ascending: true })
        if (error) console.error('[AutoPublisher] fetchReview error:', error)
        else console.log('[AutoPublisher] Fetched review items:', data?.length)
        setReviewItems(data ?? [])
        setLoading(false)
    }, [clienteId])

    const fetchPublished = useCallback(async () => {
        if (!clienteId) return
        setLoading(true)
        const { data } = await supabase
            .from('ap_candidate_news')
            .select('id, titulo, headline, caption, render_url, instagram_post_id, horario_agendado, status')
            .eq('cliente_id', clienteId)
            .in('status', ['posted', 'rejected'])
            .order('horario_agendado', { ascending: false })
            .limit(30)
        setPublishedItems(data ?? [])
        setLoading(false)
    }, [clienteId])

    async function handleForceProcess() {
        if (isProcessing) return
        setIsProcessing(true)
        try {
            // 1. Produção de Conteúdo (AI)
            await supabase.functions.invoke('ap-content-production', {
                body: { action: 'process_selected' }
            })
            // 2. Renderização de Imagem
            await supabase.functions.invoke('ap-render-engine')

            // Sucesso
            fetchCounts()
            fetchReview()
        } catch (err) {
            console.error('[AutoPublisher] handleForceProcess error:', err)
        } finally {
            setIsProcessing(false)
        }
    }

    useEffect(() => {
        if (!clienteId) return
        fetchSystemConfig()
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchCounts()
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (tab === 'review') fetchReview()
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (tab === 'published') fetchPublished()

        // 🌟 Supabase Realtime Subscription para Autorefresh 🌟
        const channel = supabase
            .channel('autopublisher-realtime-updates')
            .on(
                'postgres_changes',
                {
                    event: '*', // Escuta INSERT, UPDATE, DELETE
                    schema: 'public',
                    table: 'ap_candidate_news',
                    // Idealmente filter: `cliente_id=eq.${clienteId}` mas RLS cuidará ou filtramos localmente
                },
                (payload) => {
                    console.log('[AutoPublisher] Realtime event recebido:', payload)
                    // Qualquer mudança de status/inserção roda recount:
                    fetchCounts()

                    // Se eu estiver na aba de revisão e o status do item afetar a revisão, eu recarrego os cards
                    if (tab === 'review') {
                        fetchReview()
                    }

                    // Se eu estiver na aba de publicados e o status for posted, recarrega a tabela de publicações
                    if (tab === 'published') {
                        fetchPublished()
                    }
                }
            )
            .subscribe((status) => {
                console.log('[AutoPublisher] Status da Inscrição Realtime:', status)
            })

        return () => {
            // Limpa o canal quando o componente desmontar (ou mudar de tenant)
            supabase.removeChannel(channel)
        }
    }, [clienteId, tab, fetchCounts, fetchReview, fetchPublished])

    async function handleApprove(item) {
        if (item.status !== 'pending_review') return
        await supabase.from('ap_candidate_news').update({ status: 'posted', instagram_post_id: 'manual_action' }).eq('id', item.id)

        await supabase.from('ap_learning_history').insert({
            cliente_id: clienteId, news_id: item.id, categoria: item.categoria, fonte_id: item.fonte_id, acao: 'approved', score_delta: 1,
        })
        fetchReview(); fetchCounts()
    }

    async function handleReject(item) {
        await supabase.from('ap_candidate_news').update({ status: 'rejected' }).eq('id', item.id)
        await supabase.from('ap_learning_history').insert({
            cliente_id: clienteId, news_id: item.id, categoria: item.categoria, fonte_id: item.fonte_id, acao: 'rejected', score_delta: -1,
        })
        fetchReview(); fetchCounts()
    }

    async function submitManualNews(e) {
        e.preventDefault()
        if (!manualForm.titulo || !manualForm.conteudo) return
        setIsSubmittingManual(true)

        let finalImageUrl = manualForm.imagem_url || null

        // 1. Upload File se existir
        if (selectedFile) {
            const fileExt = selectedFile.name.split('.').pop()
            const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`

            const { error: uploadError } = await supabase.storage
                .from('ap_media')
                .upload(fileName, selectedFile)

            if (uploadError) {
                console.error('[AutoPublisher] Img Upload Error:', uploadError)
                alert('Erro ao fazer upload da imagem.')
            } else {
                const { data: pubData } = supabase.storage.from('ap_media').getPublicUrl(fileName)
                finalImageUrl = pubData.publicUrl
            }
        }

        // 2. Insert DB
        const { data, error } = await supabase.from('ap_candidate_news').insert({
            cliente_id: clienteId,
            titulo: manualForm.titulo,
            conteudo: manualForm.conteudo,
            imagem_url: finalImageUrl,
            context_tag: manualForm.context_tag ? manualForm.context_tag.trim().toUpperCase() : null,
            status: 'selected', // Send directly to AI 
            url_original: `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        }).select('id').single()

        if (error) {
            console.error('[AutoPublisher] Manual Error:', error)
            setIsSubmittingManual(false)
            return
        }

        // 3. Disparar Motor Editorial imediatamente para esta matéria
        if (data?.id) {
            try {
                await supabase.functions.invoke('ap-content-production', {
                    body: {
                        action: 'process_selected',
                        newsId: data.id
                    }
                })
                // Em seguida, disparar o Render Engine apenas para esta matéria
                await supabase.functions.invoke('ap-render-engine', {
                    body: {
                        action: 'render_one',
                        newsId: data.id
                    }
                })
            } catch (fnErr) {
                console.error('[AutoPublisher] pipeline manual error:', fnErr)
            }
        }

        setIsSubmittingManual(false)
        setManualModalOpen(false)
        setManualForm({ titulo: '', conteudo: '', imagem_url: '', context_tag: '' })
        setSelectedFile(null)
        setTab('review')
        fetchCounts()
        fetchReview()
    }

    const displayedReview = stageFilter
        ? reviewItems.filter(i => i.status === stageFilter || (stageFilter === 'queued_for_posting' && i.status === 'approved'))
        : reviewItems.filter(i => i.status === 'pending_review')

    return (
        <div className="ap-page">
            <div className="ap-main">
                {/* ── Page Header ─────────────────────────── */}
                <div className="ap-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Rss size={20} style={{ color: 'var(--color-primary)' }} />
                        <h1 className="ap-header-title">AutoPublisher</h1>
                        <span className="ap-badge-live" style={{ background: ingestionEnabled ? 'var(--color-success-bg)' : '#f3f4f6', color: ingestionEnabled ? 'var(--color-success-text)' : '#6b7280' }}>
                            {ingestionEnabled ? 'Motor Ativo' : 'Desativado'}
                        </span>
                        {/* Toggle Switch */}
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                marginLeft: '12px',
                                padding: '4px 12px',
                                background: '#fff',
                                border: '1px solid #dbdbdb',
                                borderRadius: '20px'
                            }}
                        >
                            <div
                                onClick={toggleIngestion}
                                style={{
                                    width: '36px', height: '20px',
                                    background: ingestionEnabled ? '#0095f6' : '#e5e7eb',
                                    borderRadius: '10px', position: 'relative',
                                    transition: 'background 0.2s', cursor: 'pointer'
                                }}
                            >
                                <div style={{
                                    width: '16px', height: '16px', background: '#fff', borderRadius: '50%',
                                    position: 'absolute', top: '2px', left: ingestionEnabled ? '18px' : '2px',
                                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                                }} />
                            </div>
                            <span
                                style={{ fontSize: '13px', fontWeight: 600, color: '#262626', cursor: 'pointer' }}
                                onClick={toggleIngestion}
                            >
                                Pausar Ingestão
                            </span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                            className="ap-btn-refresh"
                            style={{ background: 'var(--color-primary)', color: '#fff', border: 'none' }}
                            onClick={() => setManualModalOpen(true)}
                        >
                            <Plus size={14} /> Nova Matéria
                        </button>
                        <button
                            className="ap-btn-refresh"
                            style={{
                                background: isProcessing ? '#f3f4f6' : 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
                                color: isProcessing ? '#9ca3af' : '#fff',
                                border: 'none',
                                opacity: isProcessing ? 0.7 : 1,
                                cursor: isProcessing ? 'not-allowed' : 'pointer'
                            }}
                            onClick={handleForceProcess}
                            disabled={isProcessing}
                        >
                            <Zap size={14} className={isProcessing ? 'spin-anim' : ''} />
                            {isProcessing ? 'Processando...' : 'Processar Tudo'}
                        </button>
                        <button className="ap-btn-refresh" onClick={() => { fetchCounts(); if (tab === 'review') fetchReview(); else fetchPublished(); }}>
                            <RefreshCcw size={14} /> Atualizar
                        </button>
                    </div>
                </div>

                {/* ── Metric Cards ─────────────────────────── */}
                <div className="ap-metrics">
                    {[
                        { label: 'Ingeridas Hoje', val: metrics.ingeridas },
                        { label: 'Selecionadas para IA', val: metrics.processadas },
                        { label: 'Aguardando Aprovação', val: metrics.revisao },
                        { label: 'Agendadas p/ Postagem', val: metrics.agendadas },
                        { label: 'Publicações Feitas', val: metrics.publicadas },
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
                            onClick={() => {
                                setStageFilter(p => p === key ? null : key)
                                if (key === 'posted') setTab('published')
                                else if (key !== 'settings') setTab('review')
                            }}
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
                        ['editorial', 'Motor Editorial'],
                        ['settings', 'Configurações']
                    ].map(([key, label]) => (
                        <button key={key} className={`ap-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
                            {label}
                        </button>
                    ))}
                </div>

                {/* ── Content Area ─────────────────────────── */}
                {tab === 'review' && (
                    loading ? (
                        <div className="ap-cards-grid">
                            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
                        </div>
                    ) : displayedReview.length === 0 ? <EmptyStatePremium /> : (
                        <div className="ap-cards-grid">
                            {displayedReview.map(item => (
                                <ReviewCard key={item.id} item={item} onApprove={handleApprove} onReject={handleReject} />
                            ))}
                        </div>
                    )
                )}

                {tab === 'published' && (
                    loading ? <SkeletonTable rows={5} cols={5} /> : publishedItems.length === 0 ? <EmptyStatePremium /> : (
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

                {tab === 'editorial' && <EditorialEngine clienteId={clienteId} />}
                {tab === 'settings' && <AutoPublisherSettings clienteId={clienteId} />}
            </div>

            {/* Modal de Inserção Automática/Manual */}
            {isManualModalOpen && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', width: '500px', maxWidth: '90%', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Pencil size={18} /> Pauta Manual
                            </h2>
                            <button onClick={() => {
                                setManualModalOpen(false);
                                setSelectedFile(null);
                                setManualForm({ titulo: '', conteudo: '', imagem_url: '', context_tag: '' });
                            }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)' }}><X size={20} /></button>
                        </div>
                        <form onSubmit={submitManualNews} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>TÍTULO DA POSTAGEM</label>
                                <input
                                    className="pt-input"
                                    required
                                    value={manualForm.titulo}
                                    onChange={e => setManualForm({ ...manualForm, titulo: e.target.value })}
                                    placeholder="Ex: Prefeito anuncia nova ponte..."
                                    style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', outline: 'none' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>TEXTO BRUTO / CONTEÚDO</label>
                                <textarea
                                    className="pt-input"
                                    required
                                    value={manualForm.conteudo}
                                    onChange={e => setManualForm({ ...manualForm, conteudo: e.target.value })}
                                    placeholder="Cole aqui o release ou os dados da matéria para que a Inteligência Artificial faça a formatação editorial..."
                                    rows={5}
                                    style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', outline: 'none', resize: 'vertical' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>TAG DO VÍDEO / MATÉRIA (OPCIONAL)</label>
                                <input
                                    className="pt-input"
                                    value={manualForm.context_tag || ''}
                                    onChange={e => setManualForm({ ...manualForm, context_tag: e.target.value.toUpperCase() })}
                                    maxLength={20}
                                    placeholder="Ex: URGENTE, POLÍCIA... Se vazio, a IA define sozinha."
                                    style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--color-border)', outline: 'none' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '6px' }}>IMAGEM DA CAPA (OPCIONAL)</label>
                                <div
                                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                                    onDragLeave={() => setIsDragging(false)}
                                    onDrop={e => {
                                        e.preventDefault();
                                        setIsDragging(false);
                                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                                            setSelectedFile(e.dataTransfer.files[0]);
                                            setManualForm({ ...manualForm, imagem_url: '' });
                                        }
                                    }}
                                    style={{
                                        border: isDragging ? '2px dashed var(--color-primary)' : '2px dashed var(--color-border)',
                                        borderRadius: '8px',
                                        padding: '24px',
                                        textAlign: 'center',
                                        background: isDragging ? 'rgba(0,149,246,0.05)' : '#fafafa',
                                        cursor: 'pointer',
                                        position: 'relative',
                                        transition: 'all 0.2s ease'
                                    }}
                                    onClick={() => document.getElementById('manual-file-upload').click()}
                                >
                                    <input
                                        id="manual-file-upload"
                                        type="file"
                                        accept="image/*"
                                        style={{ display: 'none' }}
                                        onChange={e => {
                                            if (e.target.files && e.target.files[0]) {
                                                setSelectedFile(e.target.files[0]);
                                                setManualForm({ ...manualForm, imagem_url: '' });
                                            }
                                        }}
                                    />
                                    {selectedFile ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                                            <ImageIcon size={28} color="var(--color-primary)" />
                                            <span style={{ fontSize: '13px', color: 'var(--color-text-primary)' }}>{selectedFile.name} selecionado.</span>
                                            <span style={{ fontSize: '11px', color: 'var(--color-primary)' }}>Clique ou solte outra imagem para trocar</span>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                                            <UploadCloud size={28} color={isDragging ? 'var(--color-primary)' : 'var(--color-text-tertiary)'} />
                                            <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                                                Arraste uma imagem ou clique para selecionar
                                            </span>
                                            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>JPG, PNG ou WEBP</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
                                <button type="button" onClick={() => { setManualModalOpen(false); setSelectedFile(null); }} style={{ padding: '10px 16px', borderRadius: '6px', border: '1px solid var(--color-border)', background: '#fff', cursor: 'pointer', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Cancelar</button>
                                <button type="submit" disabled={isSubmittingManual} style={{ padding: '10px 16px', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: '#fff', cursor: isSubmittingManual ? 'not-allowed' : 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {isSubmittingManual ? 'Enviando p/ IA...' : <><Brain size={16} /> Enviar para Formatação</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

// ──────────────────────────────────────────────────────────
// Components
// ──────────────────────────────────────────────────────────


function ReviewCard({ item, onApprove, onReject }) {
    const rawScore = item.candidate_scores?.score_total
    const score = rawScore != null ? Math.round(rawScore * 10) : null
    const [copied, setCopied] = useState(false)
    const [isExpanded, setIsExpanded] = useState(false)

    const handleCopy = () => {
        const text = `${item.headline ?? item.titulo}\n\n${item.caption ?? ''}`
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const handleDownload = async () => {
        if (!item.render_url && !item.imagem_url) return
        const url = item.render_url ?? item.imagem_url
        try {
            let response
            try {
                response = await fetch(url)
            } catch (e) {
                // Fallback (Proxy de CORS): Puxa a imagem engarrafada por um túnel se o Placid barrar
                response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`)
            }

            const blob = await response.blob()
            const blobUrl = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = blobUrl
            a.download = `tvg_noticia_${item.id.slice(0, 6)}.jpg`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(blobUrl)
        } catch (err) {
            console.error('Erro forçado ao baixar:', err)
            alert('Não foi possível baixar a imagem silenciocamente. Abrindo arquivo bruto.')
            window.open(url, '_blank')
        }
    }

    return (
        <div className="ap-review-card insta-mock" style={{ maxWidth: '400px', margin: '0 auto', background: '#fff', border: '1px solid #dbdbdb', borderRadius: '8px', paddingBottom: '16px', display: 'flex', flexDirection: 'column' }}>

            {/* Header (Score / Confiança / Fake Header Insta) */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #efefef' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img src="/tvgmulti-logo.jpg" style={{ width: 24, height: 24, borderRadius: '50%' }} alt="Avatar" />
                        </div>
                    </div>
                    <div>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#262626' }}>tvgmulti</span>
                        <div style={{ fontSize: '11px', color: '#8e8e8e', marginTop: '2px' }}>
                            {item.context_tag ? (
                                <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{item.context_tag} • </span>
                            ) : item.categoria ? (
                                <span>{item.categoria} • </span>
                            ) : null}
                            {item.status !== 'pending_review' && <span>{item.status.replace(/_/g, ' ')} • </span>}
                            Score: {score ?? '—'}
                        </div>
                    </div>
                </div>
                <MoreVertical size={16} color="#262626" />
            </div>

            {/* Imagem (1:1 ou 4:5 aspect ratio) */}
            <div className="ap-card-img-wrap" style={{ aspectRatio: '4/5', width: '100%', background: '#fafafa', position: 'relative' }}>
                {item.render_url || item.imagem_url ? (
                    <img
                        className="ap-card-img"
                        src={item.render_url ?? item.imagem_url}
                        onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                        alt=""
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                ) : null}

                {/* Fallback View (mostrada se não tiver imagem, ou se a imagem falhar no onError) */}
                <div
                    className="ap-card-img-placeholder"
                    style={{ display: (item.render_url || item.imagem_url) ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', position: 'absolute', top: 0, left: 0, background: '#fafafa' }}
                >
                    <ImageIcon size={32} color="#dbdbdb" />
                </div>
            </div>

            {/* Ações Insta (Like, Comment, Share, Save) */}
            <div style={{ padding: '12px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '16px' }}>
                    <Heart size={24} color="#262626" />
                    <MessageCircle size={24} color="#262626" />
                    <Send size={24} color="#262626" />
                </div>
                <Bookmark size={24} color="#262626" />
            </div>

            {/* Body (Caption) */}
            <div className="ap-card-body" style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                <p className="ap-card-headline" style={{ fontSize: '13px', margin: 0 }}>
                    <span style={{ fontWeight: 600, color: '#262626', marginRight: '6px' }}>tvgmulti</span>
                    {item.headline ?? item.titulo}
                </p>
                {item.caption && (
                    <>
                        <p className="ap-card-caption" style={{
                            fontSize: '13px',
                            color: '#262626',
                            margin: '4px 0 0 0',
                            display: isExpanded ? 'block' : '-webkit-box',
                            WebkitLineClamp: isExpanded ? 'initial' : 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: isExpanded ? 'visible' : 'hidden'
                        }}>
                            {item.caption}
                        </p>
                        {item.caption.length > 100 && (
                            <button
                                onClick={() => setIsExpanded(!isExpanded)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    color: '#8e8e8e',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    marginTop: '2px'
                                }}
                            >
                                {isExpanded ? 'Ver menos' : '... mais'}
                            </button>
                        )}
                    </>
                )}

                {item.horario_agendado && (
                    <div style={{ fontSize: '11px', color: '#8e8e8e', marginTop: '6px', textTransform: 'uppercase' }}>
                        Agendado para: {new Date(item.horario_agendado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                    </div>
                )}
            </div>

            {/* Ações de Aprovação (Rejeitar / Editar / Aprovar) */}
            {item.status === 'pending_review' && (
                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={handleDownload} title="Baixar Arte" style={{ flex: 1, background: '#fff', border: '1px solid #dbdbdb', borderRadius: '8px', padding: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: '#262626', cursor: 'pointer' }}>
                            <Download size={14} /> Baixar Arte
                        </button>
                        <button onClick={handleCopy} title="Copiar Texto" style={{ flex: 1, background: copied ? 'var(--color-success-bg)' : '#fff', border: copied ? '1px solid var(--color-success-text)' : '1px solid #dbdbdb', borderRadius: '8px', padding: '8px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: copied ? 'var(--color-success-text)' : '#262626', cursor: 'pointer', transition: 'all 0.2s' }}>
                            {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado!' : 'Copiar Texto'}
                        </button>
                    </div>

                    <div className="ap-card-actions" style={{ display: 'flex', gap: '8px', borderTop: 'none', background: 'transparent', padding: '0' }}>
                        <button className="ap-btn-reject" onClick={() => onReject(item)} title="Descartar" style={{ background: '#fff', border: '1px solid #dbdbdb', borderRadius: '8px', padding: '8px', color: '#ed4956', flexShrink: 0, cursor: 'pointer' }}>
                            <X size={16} />
                        </button>
                        <button className="ap-btn-approve" onClick={() => onApprove(item)} style={{ background: '#0095f6', color: '#fff', border: 'none', borderRadius: '8px', padding: '8px', fontSize: '13px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, cursor: 'pointer' }}>
                            Marcar como Publicado <Check size={16} style={{ marginLeft: 6 }} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

function EmptyStatePremium() {
    return (
        <div className="ap-empty">
            <div className="ap-empty-icon"><Info size={20} /></div>
            <p className="ap-empty-title">Nenhum Registro</p>
            <p className="ap-empty-sub">A fila de processos se encontra vazia no momento.</p>
        </div>
    )
}
