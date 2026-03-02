import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../services/supabase'
import '../../styles/AutoPublisher.css'
import {
    Rss, RefreshCcw, Check, X, Pencil, Copy, Download,
    ImageIcon, Clock, Zap, Info, Filter, MoreVertical, Brain, Heart, MessageCircle, Send, Bookmark, Plus, UploadCloud, Link2,
    Video, CheckCircle2
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
    { key: 'studio', label: 'Gravação' },
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
    const [employeeItems, setEmployeeItems] = useState([])
    const [loading, setLoading] = useState(false)
    const [metrics, setMetrics] = useState({ ingeridas: 0, processadas: 0, revisao: 0, agendadas: 0, publicadas: 0 })
    const [ingestionEnabled, setIngestionEnabled] = useState(true)
    const [isProcessing, setIsProcessing] = useState(false)

    // Manual Input State
    const [isManualModalOpen, setManualModalOpen] = useState(false)
    const [manualForm, setManualForm] = useState({ titulo: '', conteudo: '', imagem_url: '', context_tag: '', url_original: '' })
    const [isSubmittingManual, setIsSubmittingManual] = useState(false)
    const [selectedFile, setSelectedFile] = useState(null)
    const [isDragging, setIsDragging] = useState(false)

    const fetchSystemConfig = useCallback(async () => {
        if (!clienteId) return
        const { data } = await supabase.schema('ap').from('system_config').select('ingestion_enabled').eq('cliente_id', clienteId).single()
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
        categoria, fonte_id, visual_energy_level, context_tag,
        studio_media_image_url, studio_media_video_url, enviado_para_studio, roteiro_studio
      `)
            .eq('cliente_id', clienteId)
            .in('status', ['raw', 'scored', 'selected', 'pending_render', 'pending_review', 'approved', 'queued_for_posting', 'studio_selected', 'studio_ready'])
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

    const fetchEmployeeItems = useCallback(async () => {
        if (!clienteId) return
        setLoading(true)

        try {
            // 1. Fetch news items
            const { data: newsData, error: newsError } = await supabase
                .from('ap_candidate_news_complete')
                .select(`id, titulo, headline, caption, render_url, imagem_url, status, gerado_em, template_nome_snapshot, template_ordem, criado_por_user_id, context_tag`)
                .eq('cliente_id', clienteId)
                .eq('role_criador', 'employee')
                .order('gerado_em', { ascending: false })
                .limit(50)

            if (newsError) throw newsError;

            // 2. Fetch user emails mapping
            const { data: usersData, error: usersError } = await supabase.rpc('get_user_emails_for_ap');

            if (usersError) {
                console.warn("Could not fetch user emails", usersError);
                setEmployeeItems(newsData || []);
            } else {
                // Create a map of id -> email
                const userMap = {};
                if (usersData) {
                    usersData.forEach(u => userMap[u.id] = { nome: u.nome, email: u.email });
                }

                // Map nome and email back to the news items
                const mappedData = (newsData || []).map(item => ({
                    ...item,
                    criado_por_nome: userMap[item.criado_por_user_id]?.nome || null,
                    criado_por_email: userMap[item.criado_por_user_id]?.email || null
                }));

                setEmployeeItems(mappedData);
            }
        } catch (err) {
            console.error('[AutoPublisher] fetchEmployeeItems error:', err);
            setEmployeeItems([]);
        } finally {
            setLoading(false);
        }
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
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (tab === 'employee') fetchEmployeeItems()

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
    }, [clienteId, tab, fetchCounts, fetchReview, fetchPublished, fetchEmployeeItems, fetchSystemConfig])

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

    async function handleStudio(item) {
        if (item.status !== 'pending_review') return
        setIsProcessing(true) // Mostrar loading visual
        try {
            const { error } = await supabase.functions.invoke('ap-content-production', { body: { action: 'process_studio', newsId: item.id } });
            if (error) throw error;
            alert("Roteiro de Estúdio gerado com sucesso!")
        } catch (err) {
            console.error('[AutoPublisher] handleStudio error:', err)
            alert("Falha ao gerar roteiro do estúdio pela IA.")
        }
        setIsProcessing(false)
        fetchReview(); fetchCounts()
    }

    async function handleSendToStudio(item) {
        if (item.enviado_para_studio) return
        const ok = confirm("Confirma o envio do roteiro e ativos para o Estúdio?");
        if (!ok) return;

        try {
            const { error } = await supabase.functions.invoke('ap-send-to-studio', { body: { newsId: item.id } });
            if (error) throw error;
            alert("Enviado para gravação com sucesso!");
        } catch (err) {
            console.error('[AutoPublisher] handleSendToStudio error:', err)
            alert("Falha ao sincronizar com o Estúdio.")
        }
        fetchReview(); fetchCounts()
    }

    async function handleApproveSelected(item) {
        if (item.status !== 'selected') return
        setIsProcessing(true) // Mostrar loading visual
        try {
            // Repassa para a IA, forçando formatação e dps Engine
            const { error } = await supabase.functions.invoke('ap-content-production', { body: { action: 'process_selected', newsId: item.id } });
            if (error) throw error;
            await supabase.functions.invoke('ap-render-engine');
            alert("Texto e Arte gerados com sucesso e enviados para Revisão Editorial!")
        } catch (err) {
            console.error('[AutoPublisher] handleApproveSelected error:', err)
            alert("Falha ao aprovar matéria selecionada.")
        }
        setIsProcessing(false)
        fetchReview(); fetchCounts()
    }

    async function submitManualNews(e) {
        e.preventDefault()

        if (!manualForm.titulo && !manualForm.url_original) {
            alert('Você precisa preencher o título da matéria OU colar um link válido.');
            return;
        }

        setIsSubmittingManual(true)

        if (manualForm.url_original) {
            // Check for duplicates first using the complete view to get more details if needed
            const { data: existingNews, error: searchError } = await supabase
                .from('ap_candidate_news')
                .select('id')
                .eq('url_original', manualForm.url_original)
                .limit(1);

            if (!searchError && existingNews && existingNews.length > 0) {
                alert(`Esta matéria já foi enviada ao sistema por outro usuário. Pautas duplicadas não são permitidas.`);
                setIsSubmittingManual(false);
                return;
            }
        }

        let finalTitulo = manualForm.titulo;
        let finalConteudo = manualForm.conteudo;
        let finalImageUrl = manualForm.imagem_url || null;

        // Auto-Scraping Logic (If URL is provided but content is missing)
        if (manualForm.url_original && (!finalTitulo || !finalConteudo)) {
            try {
                const { data, error } = await supabase.functions.invoke('ap-link-scraper', {
                    body: { url: manualForm.url_original }
                });
                if (error) throw error;

                finalTitulo = data.title || finalTitulo;
                finalConteudo = data.content || finalConteudo;
                finalImageUrl = data.image_url || finalImageUrl;
            } catch (err) {
                console.error('[AutoPublisher] Auto-Scrape error:', err);
                alert('A IA tentou extrair os dados do link, mas falhou. Verifique se a URL é suportada ou preencha o texto manualmente.');
                setIsSubmittingManual(false);
                return;
            }
        }

        if (!finalTitulo || !finalConteudo) {
            alert('Não foi possível obter Título e Conteúdo. Preencha manualmente ou tente outro link.');
            setIsSubmittingManual(false);
            return;
        }

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
            titulo: finalTitulo,
            conteudo: finalConteudo,
            imagem_url: finalImageUrl,
            context_tag: manualForm.context_tag ? manualForm.context_tag.trim().toUpperCase() : null,
            status: 'selected', // Send directly to AI 
            url_original: manualForm.url_original || null
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
        ? reviewItems.filter(i => {
            if (stageFilter === 'studio') return i.status === 'studio_selected' || i.status === 'studio_ready'
            if (stageFilter === 'queued_for_posting') return i.status === 'approved' || i.status === 'queued_for_posting'
            return i.status === stageFilter
        })
        : reviewItems.filter(i => i.status === 'pending_review')

    return (
        <>
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
                            ['employee', 'Auditoria'],
                            ['settings', 'Configurações']
                        ].map(([key, label]) => (
                            <button key={key} className={`ap-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
                                {label}
                            </button>
                        ))}
                    </div>

                </div>

                {/* ── Content Area ─────────────────────────── */}
                {tab === 'employee' && (
                    <div style={{ padding: '20px', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#0f172a' }}>Histórico de Geração (Funcionários)</h2>
                            <button
                                onClick={async () => {
                                    if (!confirm('Tem certeza que deseja forçar o reinício da Fila de Templates? O próximo post gerado usará o Primeiro Template (Ordem 1).')) return;
                                    await supabase.schema('ap').from('template_queue_state').upsert({ empresa_id: clienteId, current_index: 1 });
                                    alert('Fila de templates reiniciada (Próximo será o Template #1).');
                                }}
                                style={{ padding: '8px 16px', background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}
                            >
                                <RefreshCcw size={16} /> Resetar Fila Global
                            </button>
                        </div>

                        {loading ? (
                            <SkeletonTable />
                        ) : employeeItems.length === 0 ? (
                            <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
                                <ImageIcon size={40} style={{ marginBottom: '12px', opacity: 0.4 }} />
                                <p style={{ margin: 0, fontWeight: 500 }}>Nenhuma matéria gerada por funcionários ainda.</p>
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gap: '12px' }}>
                                {employeeItems.map(item => {
                                    const STATUS_PTBR = {
                                        processing: { label: 'Processando', bg: '#fef9c3', color: '#854d0e' },
                                        ready_to_publish: { label: 'Pronto', bg: '#dcfce7', color: '#166534' },
                                        published: { label: 'Publicado', bg: '#dbeafe', color: '#1e40af' },
                                        failed: { label: 'Falhou', bg: '#fee2e2', color: '#991b1b' },
                                        failed_generation: { label: 'Falhou', bg: '#fee2e2', color: '#991b1b' },
                                    };
                                    const badge = STATUS_PTBR[item.status] || { label: item.status || 'Desconhecido', bg: '#f1f5f9', color: '#475569' };
                                    const titleText = item.headline || item.titulo || 'Sem título';
                                    const thumb = item.render_url || item.imagem_url;
                                    return (
                                        <div key={item.id} style={{ display: 'flex', gap: '16px', padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', alignItems: 'flex-start', transition: 'box-shadow 0.2s' }}>
                                            {/* Thumbnail */}
                                            <div style={{ flexShrink: 0 }}>
                                                {thumb ? (
                                                    <a href={thumb} target="_blank" rel="noreferrer">
                                                        <img
                                                            src={thumb}
                                                            alt=""
                                                            style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '10px', border: '2px solid #e2e8f0', display: 'block' }}
                                                        />
                                                    </a>
                                                ) : (
                                                    <div style={{ width: '80px', height: '80px', background: '#e2e8f0', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <ImageIcon size={24} color="#94a3b8" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Content */}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
                                                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: badge.bg, color: badge.color, letterSpacing: '0.03em' }}>
                                                        {badge.label}
                                                    </span>
                                                    {item.context_tag && (
                                                        <span style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: '#e0e7ff', color: '#3730a3' }}>
                                                            {item.context_tag}
                                                        </span>
                                                    )}
                                                    {item.template_nome_snapshot && (
                                                        <span style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }}>
                                                            #{item.template_ordem} {item.template_nome_snapshot}
                                                        </span>
                                                    )}
                                                </div>

                                                <div style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', marginBottom: '8px' }}>
                                                    {titleText}
                                                </div>

                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '8px' }}>
                                                    {/* Creator */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '12px', fontWeight: 700, flexShrink: 0 }}>
                                                            {(item.criado_por_nome || item.criado_por_email || 'A').charAt(0).toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>{item.criado_por_nome || item.criado_por_email?.split('@')[0] || 'Anônimo'}</div>
                                                            <div style={{ fontSize: '11px', color: '#94a3b8' }}>{item.criado_por_email || '—'}</div>
                                                        </div>
                                                    </div>

                                                    {/* Date + Actions */}
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                                                            {item.gerado_em ? new Date(item.gerado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                                                        </span>
                                                        <button
                                                            onClick={() => { navigator.clipboard.writeText(item.caption || ''); }}
                                                            style={{ fontSize: '12px', padding: '5px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: '#475569', fontWeight: 500 }}
                                                            title="Copiar legenda"
                                                        >
                                                            <Copy size={12} /> Legenda
                                                        </button>
                                                        {item.render_url && (
                                                            <button
                                                                onClick={() => window.open(item.render_url, '_blank')}
                                                                style={{ fontSize: '12px', padding: '5px 10px', borderRadius: '6px', border: 'none', background: '#0f172a', color: '#fff', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                                                title="Baixar arte"
                                                            >
                                                                <Download size={12} /> Arte
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {tab === 'review' && (
                    loading ? (
                        <div className="ap-cards-grid">
                            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
                        </div>
                    ) : displayedReview.length === 0 ? <EmptyStatePremium /> : (
                        <div className="ap-cards-grid">
                            {displayedReview.map(item => (
                                <ReviewCard
                                    key={item.id}
                                    item={item}
                                    onApprove={handleApprove}
                                    onReject={handleReject}
                                    onStudio={handleStudio}
                                    onSendToStudio={handleSendToStudio}
                                    onApproveSelected={handleApproveSelected}
                                />
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
            {
                isManualModalOpen && (
                    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                        <div className="ap-modal-content" style={{ background: '#ffffff', padding: '0', borderRadius: '20px', width: '560px', maxWidth: '100%', boxShadow: '0 24px 48px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                            {/* Header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '24px', borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
                                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111827', margin: 0, display: 'flex', alignItems: 'center', gap: '10px', letterSpacing: '-0.02em' }}>
                                    <div style={{ background: '#eff6ff', color: '#3b82f6', padding: '8px', borderRadius: '10px', display: 'flex' }}><Pencil size={18} /></div>
                                    Nova Pauta
                                </h2>
                                <button onClick={() => {
                                    setManualModalOpen(false);
                                    setSelectedFile(null);
                                    setManualForm({ titulo: '', conteudo: '', imagem_url: '', context_tag: '', url_original: '' });
                                }} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', color: '#6b7280', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Body */}
                            <form onSubmit={submitManualNews} style={{ display: 'flex', flexDirection: 'column', padding: '24px', gap: '20px', maxHeight: '75vh', overflowY: 'auto' }}>

                                {/* Link Source - Highlighted Block */}
                                <div style={{ padding: '16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        <Link2 size={14} color="#3b82f6" /> Motor de Scraping (Link)
                                    </label>
                                    <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Cole o link original. Nossa IA irá ler, extrair fotos e montar a estrutura sozinha.</p>
                                    <input
                                        value={manualForm.url_original || ''}
                                        onChange={e => setManualForm({ ...manualForm, url_original: e.target.value })}
                                        placeholder="https://g1.globo.com/exemplo..."
                                        style={{ width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', fontSize: '14px', transition: 'border-color 0.2s', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)' }}
                                        onFocus={e => e.target.style.borderColor = '#3b82f6'}
                                        onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                                    />
                                </div>

                                {/* Separator */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', opacity: 0.6 }}>
                                    <div style={{ height: '1px', background: '#e2e8f0', flex: 1 }}></div>
                                    <span style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>Ou crie manualmente</span>
                                    <div style={{ height: '1px', background: '#e2e8f0', flex: 1 }}></div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>Título da Matéria</label>
                                        <input
                                            value={manualForm.titulo}
                                            onChange={e => setManualForm({ ...manualForm, titulo: e.target.value })}
                                            placeholder="Prefeito anuncia nova ponte na cidade..."
                                            style={{ width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', outline: 'none', fontSize: '14px', transition: 'all 0.2s' }}
                                            onFocus={e => e.target.style.borderColor = '#94a3b8'}
                                            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                                        />
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>Texto Bruto (Conteúdo)</label>
                                        <textarea
                                            value={manualForm.conteudo}
                                            onChange={e => setManualForm({ ...manualForm, conteudo: e.target.value })}
                                            placeholder="Cole o release da ascom ou o corpo do texto aqui..."
                                            rows={4}
                                            style={{ width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', outline: 'none', fontSize: '14px', resize: 'vertical', minHeight: '100px', transition: 'all 0.2s' }}
                                            onFocus={e => e.target.style.borderColor = '#94a3b8'}
                                            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                                        />
                                    </div>

                                    <div style={{ display: 'flex', gap: '16px' }}>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>Tag de Editoria</label>
                                            <input
                                                value={manualForm.context_tag || ''}
                                                onChange={e => setManualForm({ ...manualForm, context_tag: e.target.value.toUpperCase() })}
                                                maxLength={20}
                                                placeholder="Ex: URGENTE"
                                                style={{ width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', outline: 'none', fontSize: '14px', transition: 'all 0.2s' }}
                                                onFocus={e => e.target.style.borderColor = '#94a3b8'}
                                                onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>Assets Visuais (Capa)</label>
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
                                                border: isDragging ? '2px dashed #3b82f6' : '2px dashed #cbd5e1',
                                                borderRadius: '12px',
                                                padding: '24px 16px',
                                                textAlign: 'center',
                                                background: isDragging ? '#eff6ff' : '#f8fafc',
                                                cursor: 'pointer',
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
                                                    <div style={{ background: '#dcfce7', color: '#16a34a', padding: '12px', borderRadius: '50%' }}>
                                                        <ImageIcon size={24} />
                                                    </div>
                                                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>Arquivo selecionado com sucesso</span>
                                                    <span style={{ fontSize: '13px', color: '#64748b' }}>{selectedFile.name}</span>
                                                </div>
                                            ) : manualForm.imagem_url ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                                                    <div style={{ width: 100, height: 60, borderRadius: '8px', overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                                                        <img src={manualForm.imagem_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="Preview AI" />
                                                    </div>
                                                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#3b82f6' }}>Imagem Extraída Automática!</span>
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                                                    <div style={{ background: '#f1f5f9', color: '#64748b', padding: '12px', borderRadius: '50%' }}>
                                                        <UploadCloud size={24} />
                                                    </div>
                                                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>Fazer upload de foto</span>
                                                    <span style={{ fontSize: '13px', color: '#64748b' }}>Arraste um JPEG/PNG ou clique aqui</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Footer Base */}
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', paddingTop: '20px', borderTop: '1px solid #f0f0f0', marginTop: '10px' }}>
                                    <button type="button" onClick={() => { setManualModalOpen(false); setSelectedFile(null); }} style={{ padding: '12px 20px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontWeight: 600, color: '#475569', fontSize: '14px', transition: 'all 0.2s' }}>Cancelar</button>
                                    <button type="submit" disabled={isSubmittingManual} style={{ padding: '12px 24px', borderRadius: '10px', border: 'none', background: '#111827', color: '#fff', cursor: isSubmittingManual ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 6px -1px rgba(17, 24, 39, 0.1), 0 2px 4px -1px rgba(17, 24, 39, 0.06)', transition: 'all 0.2s' }}>
                                        {isSubmittingManual ? 'Carregando Motor...' : <><Brain size={18} /> Injetar no Motor IA</>}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )
            }
        </>
    )
}

// ──────────────────────────────────────────────────────────
// Components
// ──────────────────────────────────────────────────────────


function ReviewCard({ item, onApprove, onReject, onStudio, onSendToStudio, onApproveSelected }) {
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
        <div className="ap-review-card insta-mock" style={{ maxWidth: '400px', margin: '0 auto', paddingBottom: '16px' }}>

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

            {/* Body (Caption / Roteiro) */}
            <div className="ap-card-body" style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                <p className="ap-card-headline" style={{ fontSize: '13px', margin: 0 }}>
                    <span style={{ fontWeight: 600, color: '#262626', marginRight: '6px' }}>tvgmulti</span>
                    {item.headline ?? item.titulo}
                </p>
                {(item.status === 'studio_selected' || item.status === 'studio_ready') ? (
                    item.roteiro_studio && (
                        <div style={{ marginTop: '8px', fontSize: '12px', color: '#262626', background: '#f5f5f5', padding: '12px', borderRadius: '4px', borderLeft: '3px solid #1c1c1e' }}>
                            <div style={{ fontWeight: 600, marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                <span>Roteiro Teleprompter:</span>
                                <span>~{item.duracao_estimada}s</span>
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>{item.roteiro_studio}</div>
                            {item.broll_sugestao && (
                                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #e0e0e0', color: '#555', fontStyle: 'italic' }}>
                                    <span style={{ fontWeight: 600, color: '#000' }}>B-Roll/Edição:</span> {item.broll_sugestao}
                                </div>
                            )}
                        </div>
                    )
                ) : item.caption && (
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

            {/* Ações de Triagem na Fila SELECIONADOS */}
            {item.status === 'selected' && (
                <div className="ap-card-actions-wrap">
                    <div className="ap-card-btn-row">
                        <button className="ap-btn-reject" onClick={() => onReject(item)} title="Descartar" style={{ flexShrink: 0 }}>
                            <X size={16} />
                        </button>
                        <button className="ap-card-btn-black" onClick={() => onStudio(item)}>
                            <Video size={14} /> Studio
                        </button>
                        <button className="ap-card-btn-primary" onClick={() => onApproveSelected(item)}>
                            Aprovar p/ IG
                        </button>
                    </div>
                </div>
            )}

            {/* Ações de Aprovação (Rejeitar / Editar / Aprovar) */}
            {item.status === 'pending_review' && (
                <div className="ap-card-actions-wrap">
                    <div className="ap-card-btn-row">
                        <button className="ap-card-btn-secondary" onClick={handleDownload} title="Baixar Arte">
                            <Download size={14} /> Baixar Arte
                        </button>
                        <button
                            className={`ap-card-btn-copy${copied ? ' copied' : ''}`}
                            onClick={handleCopy}
                            title="Copiar Texto"
                        >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            {copied ? 'Copiado!' : 'Copiar Texto'}
                        </button>
                    </div>

                    <div className="ap-card-btn-row">
                        <button className="ap-btn-reject" onClick={() => onReject(item)} title="Descartar" style={{ flexShrink: 0 }}>
                            <X size={16} />
                        </button>
                        <button className="ap-card-btn-black" onClick={() => onStudio(item)}>
                            <Video size={14} /> Studio
                        </button>
                        <button className="ap-card-btn-primary" onClick={() => onApprove(item)}>
                            Aprovar <Check size={16} />
                        </button>
                    </div>
                </div>
            )}

            {/* Ações da Gravação Mode */}
            {(item.status === 'studio_selected' || item.status === 'studio_ready') && (
                <div className="ap-card-actions-wrap">
                    {(item.studio_media_image_url || item.studio_media_video_url) && (
                        <div className="ap-card-btn-row" style={{ marginBottom: '4px' }}>
                            {item.studio_media_image_url && (
                                <button className="ap-card-btn-secondary" onClick={() => window.open(item.studio_media_image_url, '_blank')}>
                                    <Download size={14} /> Imagem
                                </button>
                            )}
                            {item.studio_media_video_url && (
                                <button className="ap-card-btn-secondary" onClick={() => window.open(item.studio_media_video_url, '_blank')}>
                                    <Download size={14} /> Vídeo
                                </button>
                            )}
                        </div>
                    )}

                    <button
                        className={`ap-card-btn-full ${item.enviado_para_studio ? 'sent' : 'unsent'}`}
                        onClick={() => onSendToStudio(item)}
                        disabled={item.enviado_para_studio}
                    >
                        {item.enviado_para_studio
                            ? <><CheckCircle2 size={15} /> Enviado para Gravação</>
                            : <><Video size={15} /> Enviar para Studio</>}
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
            <p className="ap-empty-title">Nenhum Registro</p>
            <p className="ap-empty-sub">A fila de processos se encontra vazia no momento.</p>
        </div>
    )
}
