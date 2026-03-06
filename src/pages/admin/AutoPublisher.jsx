import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../services/supabase'
import '../../styles/AutoPublisher.css'
import {
    Rss, RefreshCcw, Check, X, Copy, Download,
    ImageIcon, Zap, Info, MoreVertical, Brain, Heart, MessageCircle, Send, Bookmark, Plus, UploadCloud, Link2,
    Video, CheckCircle2, ChevronDown, ChevronUp, Pencil, Loader2
} from 'lucide-react'
import AutoPublisherSettings from './AutoPublisherSettings'
import AutoPublisherTemplates from './AutoPublisherTemplates'
import EditorialEngine from '../../features/editorial/EditorialEngine'
import { SkeletonCard, SkeletonTable } from '../../components/Skeleton'
import { toast } from 'sonner'

const FIXED_CLIENT_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'

// ──────────────────────────────────────────────────────────
// Tab config
const TABS = [
    { key: 'coletadas', label: 'Coletadas' },
    { key: 'pendentes', label: 'Pendentes' },
    { key: 'aprovadas', label: 'Aprovadas' },
    { key: 'publicadas', label: 'Publicadas' },
    { key: 'editorial', label: 'Motor Editorial' },
    { key: 'templates', label: 'Templates' },
    { key: 'settings', label: 'Configurações' },
]

// Status DB → tab mapping
const STATUS_TAB = {
    raw: 'coletadas',
    ready_for_scoring: 'coletadas',
    scored: 'coletadas',
    selected: 'pendentes',
    pending_render: 'aprovadas',
    processing: 'coletadas',
    pending_review: 'aprovadas',
    ready_to_publish: 'aprovadas',
    approved: 'aprovadas',
    queued_for_posting: 'aprovadas',
    studio_selected: 'pendentes',
    studio_ready: 'pendentes',
    posted: 'publicadas',
    failed: 'coletadas',
    rejected: 'coletadas',
}

// ──────────────────────────────────────────────────────────
export default function AutoPublisher() {
    const clienteId = FIXED_CLIENT_ID

    const [tab, setTab] = useState('pendentes')
    const [tabCounts, setTabCounts] = useState({})
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(false)
    const [ingestionEnabled, setIngestionEnabled] = useState(true)
    const [isProcessing, setIsProcessing] = useState(false)

    // Manual Input State
    const [isManualModalOpen, setManualModalOpen] = useState(false)
    const [selectedFlow, setSelectedFlow] = useState(1) // 1 | 2 | 3
    const [formData, setFormData] = useState({
        url_original: '',
        titulo: '',
        conteudo: '',
        context_tag: '',
        image_url: '',
        content_type: 'feed',
        template_set: 'default',
        placid_template_uuid: null
    })
    const [availableTemplates, setAvailableTemplates] = useState([])
    const [manualFormErrors, setManualFormErrors] = useState({})
    const [isSubmittingManual, setIsSubmittingManual] = useState(false)
    const [selectedFile, setSelectedFile] = useState(null)
    const [isDragging, setIsDragging] = useState(false)

    // Edit Item State
    const [editingItem, setEditingItem] = useState(null)
    const [editModalOpen, setEditModalOpen] = useState(false)
    const [editForm, setEditForm] = useState({ context_tag: '', headline: '', caption: '', imagem_url: '' })
    const [isSavingEdit, setIsSavingEdit] = useState(false)
    const [editSelectedFile, setEditSelectedFile] = useState(null)
    const [isEditDragging, setIsEditDragging] = useState(false)



    function resetManualModal() {
        setManualModalOpen(false)
        setSelectedFlow(1)
        setFormData({
            url_original: '',
            titulo: '',
            conteudo: '',
            context_tag: '',
            image_url: '',
            content_type: 'feed',
            template_set: 'default',
            placid_template_uuid: null
        })
        setAvailableTemplates([])
        setSelectedFile(null)
        setManualFormErrors({})
    }

    // ── Fetch system config
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

    // ── Fetch counts per tab
    const fetchCounts = useCallback(async () => {
        if (!clienteId) return
        const { data } = await supabase.schema('ap').from('candidate_news').select('status').eq('cliente_id', clienteId)
        const counts = { coletadas: 0, pendentes: 0, aprovadas: 0, publicadas: 0 }
        for (const row of data ?? []) {
            const mapped = STATUS_TAB[row.status] || 'coletadas'
            counts[mapped] = (counts[mapped] ?? 0) + 1
        }
        setTabCounts(counts)
    }, [clienteId])

    // ── Fetch items for current tab
    const fetchItems = useCallback(async (currentTab) => {
        if (!clienteId) return
        setLoading(true)

        let statuses = []
        if (currentTab === 'coletadas') statuses = ['raw', 'ready_for_scoring', 'scored', 'failed', 'rejected', 'processing']
        if (currentTab === 'pendentes') statuses = ['selected', 'studio_selected', 'studio_ready']
        if (currentTab === 'aprovadas') statuses = ['pending_render', 'pending_review', 'ready_to_publish', 'approved', 'queued_for_posting']
        if (currentTab === 'publicadas') statuses = ['posted']

        if (statuses.length === 0) {
            setItems([])
            setLoading(false)
            return
        }

        const { data, error } = await supabase
            .schema('ap')
            .from('candidate_news')
            .select(`id, titulo, headline, caption, render_url, imagem_url, imagem_storage, image_external,
                     status, created_at, context_tag, content_type,
                     template_nome_snapshot, roteiro_studio, duracao_estimada, broll_sugestao,
                     studio_media_image_url, studio_media_video_url, enviado_para_studio,
                     instagram_post_id, horario_agendado`)
            .eq('cliente_id', clienteId)
            .in('status', statuses)
            .order('updated_at', { ascending: false })

        if (error) { toast.error("Erro ao carregar itens.") }
        setItems(data ?? [])
        setLoading(false)
    }, [clienteId])

    // ── Load available templates for "individuais"
    useEffect(() => {
        if (formData.template_set === 'individuais' && formData.content_type) {
            async function loadTemplates() {
                console.log("[AutoPublisher] Fetching templates via edge function for:", {
                    template_set: 'individuais',
                    tipo: formData.content_type
                });

                try {
                    const { data, error } = await supabase.functions.invoke('ap-config', {
                        method: 'POST',
                        body: { resource: 'templates', action: 'list' }
                    })

                    if (error) {
                        console.error("[AutoPublisher] Edge function query error:", error);
                        toast.error("Erro ao carregar templates.");
                        return;
                    }

                    if (!data || data.has_error) {
                        console.error("[AutoPublisher] Edge function data error:", data?.error);
                        toast.error("Erro ao processar templates.");
                        return;
                    }

                    // Filter locally to match campaign, type and active status
                    const filtered = data.filter(t =>
                        (t.template_set === 'individuais') &&
                        (t.tipo === formData.content_type) &&
                        t.ativo
                    ).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));

                    console.log("[AutoPublisher] [EDGE] Templates found (filtered):", filtered.length);
                    setAvailableTemplates(filtered)
                } catch (err) {
                    console.error("[AutoPublisher] Failed to load templates:", err);
                    toast.error("Erro de conexão ao carregar templates.");
                }
            }
            loadTemplates()
        } else {
            setAvailableTemplates([])
            setFormData(prev => ({ ...prev, placid_template_uuid: null }))
        }
    }, [formData.template_set, formData.content_type])

    // ── Load on tab change + realtime
    useEffect(() => {
        if (!clienteId) return
        fetchSystemConfig()
        fetchCounts()
        fetchItems(tab)

        const channel = supabase
            .channel('autopublisher-realtime')
            .on('postgres_changes', { event: '*', schema: 'ap', table: 'candidate_news' }, () => {
                fetchCounts()
                fetchItems(tab)
            })
            .subscribe()

        return () => supabase.removeChannel(channel)
    }, [clienteId, tab, fetchCounts, fetchItems, fetchSystemConfig])

    // ── Actions
    async function handleReject(item) {
        // Optimistic UI update for instant feedback
        setItems(prev => prev.filter(i => i.id !== item.id))

        try {
            const { error } = await supabase.schema('ap').from('candidate_news').update({ status: 'rejected' }).eq('id', item.id)
            if (error) throw error
            fetchCounts()
        } catch (err) {
            toast.error("Falha ao excluir matéria.")
            fetchItems(tab) // revert/refresh on error
        }
    }

    async function handleStudio(item) {
        setIsProcessing(true)
        try {
            const { error } = await supabase.functions.invoke('ap-content-production', {
                body: { action: 'process_studio', newsId: item.id }
            })
            if (error) throw error
            toast.success("Roteiro de Estúdio gerado com sucesso!")
        } catch (err) {
            toast.error("Falha ao gerar roteiro do estúdio.")
        }
        setIsProcessing(false)
        fetchItems(tab); fetchCounts()
    }

    async function handleApproveSelected(item) {
        if (item.status !== 'selected' && item.status !== 'studio_ready') return
        setIsProcessing(true)
        try {
            // 'approve_for_ig' = aprovação humana explícita.
            // O worker usa os dados já salvos no banco (headline/caption/context_tag)
            // e move o status para pending_render antes de chamar o render engine.
            const { error: prodError } = await supabase.functions.invoke('ap-content-production', {
                body: {
                    action: 'approve_for_ig',
                    newsId: item.id,
                    // Passa os dados atuais do item para garantir soberania humana
                    userHeadline: item.headline || null,
                    userTag: item.context_tag || null,
                    userText: item.caption || null
                }
            })
            if (prodError) throw prodError

            const { error: renderError } = await supabase.functions.invoke('ap-render-engine', {
                body: { action: 'render_one', newsId: item.id }
            })
            if (renderError) {
                toast.info("Aprovado! Arte entrando na fila de renderização.")
            } else {
                toast.success("Aprovado e enviado para renderização!")
            }
        } catch (err) {
            toast.error("Falha ao aprovar matéria.")
        }
        setIsProcessing(false)
        fetchItems(tab); fetchCounts()
    }

    function handleEditOpen(item) {
        setEditingItem(item)
        setEditForm({
            context_tag: item.context_tag || '',
            headline: item.headline || item.titulo || '',
            caption: item.caption || '',
            imagem_url: item.imagem_url || item.render_url || ''
        })
        setEditSelectedFile(null)
        setEditModalOpen(true)
    }

    async function handleSaveEdit(e) {
        e.preventDefault()
        if (!editingItem) return
        setIsSavingEdit(true)
        try {
            const normalizedTag = (editForm.context_tag || '').trim().toUpperCase().slice(0, 20)

            let finalImageUrl = editForm.imagem_url.trim()
            if (editSelectedFile) {
                const ext = editSelectedFile.name.split('.').pop()
                const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`
                const { error: uploadError } = await supabase.storage.from('ap-images').upload(`admin_uploads/${fileName}`, editSelectedFile)
                if (uploadError) throw uploadError
                const { data: pubData } = supabase.storage.from('ap-images').getPublicUrl(`admin_uploads/${fileName}`)
                finalImageUrl = pubData.publicUrl
            }

            const payload = {
                context_tag: normalizedTag,
                headline: editForm.headline.trim(),
                caption: editForm.caption.trim(),
                imagem_url: finalImageUrl
            }
            const { error } = await supabase.schema('ap').from('candidate_news').update(payload).eq('id', editingItem.id)
            if (error) throw error

            // Optimistic UI update
            setItems(prev => prev.map(i => i.id === editingItem.id ? { ...i, ...payload } : i))

            toast.success("Edição salva com sucesso!")
            setEditModalOpen(false)
            setEditingItem(null)
            fetchCounts()
        } catch (err) {
            toast.error("Erro ao salvar edição.")
        }
        setIsSavingEdit(false)
    }

    async function handlePublish(item) {
        await supabase.schema('ap').from('candidate_news').update({ status: 'posted' }).eq('id', item.id)
        toast.success("Matéria marcada como publicada!")
        fetchItems(tab); fetchCounts()
    }

    async function handleForceProcess() {
        if (isProcessing) return
        setIsProcessing(true)
        try {
            await supabase.functions.invoke('ap-content-production', { body: { action: 'process_selected' } })
            await supabase.functions.invoke('ap-render-engine')
            toast.success("Processamento forçado concluído.")
            fetchCounts(); fetchItems(tab)
        } catch (err) {
            toast.error("Erro ao processar.")
        } finally {
            setIsProcessing(false)
        }
    }

    // ── Manual submission (Hybrid Editorial Engine)
    async function submitManualNews(e) {
        e.preventDefault()

        // 1. Validation Logic
        const newErrors = {}
        const isLinkMode = !!formData.url_original

        if (!formData.context_tag) {
            newErrors.context_tag = 'Tag é obrigatória.'
        }

        if (formData.template_set === 'individuais' && !formData.placid_template_uuid) {
            newErrors.placid_template_uuid = 'Selecione um template para a campanha individual.'
        }

        if (!isLinkMode) {
            // Manual Mode Requirements
            if (!formData.titulo) newErrors.titulo = 'Título obrigatório em modo manual.'
            if (!formData.conteudo) newErrors.conteudo = 'Conteúdo obrigatório em modo manual.'
            if (formData.content_type === 'feed' && !formData.image_url && !selectedFile) {
                newErrors.image_url = 'Imagem obrigatória para posts de feed.'
            }
        } else {
            // Link Mode Requirements
            if (selectedFlow === 2 && !formData.titulo) newErrors.titulo = 'Título obrigatório no Fluxo 2.'
            if (selectedFlow === 3 && (!formData.titulo || !formData.conteudo)) {
                newErrors.titulo = 'Título e Conteúdo obrigatórios no Fluxo 3.'
            }
        }

        if (Object.keys(newErrors).length > 0) {
            setManualFormErrors(newErrors)
            toast.error("Preencha os campos obrigatórios.")
            return
        }

        setManualFormErrors({})
        setIsSubmittingManual(true)

        // 2. Duplicate check
        if (formData.url_original) {
            const { data: existing } = await supabase.schema('ap').from('candidate_news')
                .select('id').eq('url_original', formData.url_original).eq('cliente_id', clienteId).limit(1)
            if (existing && existing.length > 0) {
                setManualFormErrors({ url_original: 'Esta matéria já foi enviada ao sistema.' })
                setIsSubmittingManual(false)
                return
            }
        } else if (formData.titulo) { // Check for duplicate headlines if no URL
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const { data: existing } = await supabase.schema('ap').from('candidate_news')
                .select('id')
                .eq('cliente_id', clienteId)
                .ilike('headline', formData.titulo)
                .gte('created_at', twentyFourHoursAgo)
                .limit(1);
            if (existing && existing.length > 0) {
                setManualFormErrors({ titulo: 'Matéria duplicada gerada nas últimas 24h.' })
                setIsSubmittingManual(false)
                return
            }
        }

        let scrapedTitle = ''
        let scrapedConteudo = ''
        let scrapedImage = ''

        // 3. Scraping (only if link provided and needed)
        if (isLinkMode && selectedFlow !== 3) {
            try {
                const { data, error } = await supabase.functions.invoke('ap-link-scraper', { body: { url: formData.url_original } })
                if (error) throw error
                scrapedTitle = data.title || ''
                scrapedConteudo = data.content || ''
                scrapedImage = data.image_url || ''
            } catch {
                setManualFormErrors({ url_original: 'Falha ao extrair dados do link. Verifique a URL.' })
                setIsSubmittingManual(false)
                return
            }
        }

        // 4. Image upload
        let finalImageUrl = formData.image_url || scrapedImage || null
        if (selectedFile) {
            try {
                const fileExt = selectedFile.name.split('.').pop()
                const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`
                const { error: uploadError } = await supabase.storage.from('ap-images').upload(`admin_uploads/${fileName}`, selectedFile)
                if (uploadError) throw uploadError

                const { data: pubData } = supabase.storage.from('ap-images').getPublicUrl(`admin_uploads/${fileName}`)
                finalImageUrl = pubData.publicUrl
            } catch (err) {
                toast.error("Erro ao subir imagem.")
            }
        }

        // 5. Standardized Payload
        const payload = {
            empresa_id: clienteId,
            url_original: formData.url_original || null,
            titulo: formData.titulo || scrapedTitle || 'Pauta OMNI',
            conteudo: formData.conteudo || scrapedConteudo || '',
            context_tag: formData.context_tag,
            image_url: finalImageUrl,
            content_type: formData.content_type || 'feed',
            template_set: formData.template_set || 'default',
            placid_template_uuid: formData.placid_template_uuid || null,
            // Legacy/Hybrid field support
            userHeadline: formData.titulo || null,
            userText: formData.conteudo || null,
            userTag: formData.context_tag.toUpperCase()
        }

        try {
            const { data, error } = await supabase.functions.invoke('ap-employee-generator', { body: payload })
            if (error) throw error

            toast.success("Matéria enviada para processamento!")
            resetManualModal()
            fetchItems(tab)
        } catch (err) {
            toast.error(err.message || "Erro ao gerar matéria.")
        } finally {
            setIsSubmittingManual(false)
        }
    }

    return (
        <>
            <div className="ap-page">
                <div className="ap-main">
                    {/* ── Page Header */}
                    <div className="ap-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <Rss size={20} style={{ color: 'var(--color-primary)' }} />
                            <h1 className="ap-header-title">AutoPublisher</h1>
                            <span className="ap-badge-live" style={{ background: ingestionEnabled ? 'var(--color-success-bg)' : '#f3f4f6', color: ingestionEnabled ? 'var(--color-success-text)' : '#6b7280' }}>
                                {ingestionEnabled ? 'Motor Ativo' : 'Desativado'}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px', padding: '4px 12px', background: '#fff', border: '1px solid #dbdbdb', borderRadius: '20px' }}>
                                <div onClick={toggleIngestion} style={{ width: '36px', height: '20px', background: ingestionEnabled ? '#0095f6' : '#e5e7eb', borderRadius: '10px', position: 'relative', transition: 'background 0.2s', cursor: 'pointer' }}>
                                    <div style={{ width: '16px', height: '16px', background: '#fff', borderRadius: '50%', position: 'absolute', top: '2px', left: ingestionEnabled ? '18px' : '2px', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', boxShadow: '0 1px 2px rgba(0,0,0,0.2)' }} />
                                </div>
                                <span style={{ fontSize: '13px', fontWeight: 600, color: '#262626', cursor: 'pointer' }} onClick={toggleIngestion}>Pausar Ingestão</span>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="ap-btn-refresh" style={{ background: 'var(--color-primary)', color: '#fff', border: 'none' }} onClick={() => setManualModalOpen(true)}>
                                <Plus size={14} /> Nova Matéria
                            </button>
                            <button
                                className="ap-btn-refresh"
                                style={{ background: isProcessing ? '#f3f4f6' : 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', color: isProcessing ? '#9ca3af' : '#fff', border: 'none', opacity: isProcessing ? 0.7 : 1, cursor: isProcessing ? 'not-allowed' : 'pointer' }}
                                onClick={handleForceProcess}
                                disabled={isProcessing}
                            >
                                <Zap size={14} className={isProcessing ? 'spin-anim' : ''} />
                                {isProcessing ? 'Processando...' : 'Processar Tudo'}
                            </button>
                            <button className="ap-btn-refresh" onClick={() => { fetchCounts(); fetchItems(tab) }}>
                                <RefreshCcw size={14} /> Atualizar
                            </button>
                        </div>
                    </div>

                    {/* ── Tabs com contadores */}
                    <div className="ap-pipeline">
                        {TABS.filter(t => ['coletadas', 'pendentes', 'aprovadas', 'publicadas'].includes(t.key)).map(({ key, label }) => (
                            <button
                                key={key}
                                className={`ap-stage${tab === key ? ' active' : ''}`}
                                onClick={() => setTab(key)}
                            >
                                <span className="ap-stage-count">{tabCounts[key] ?? 0}</span>
                                <span className="ap-stage-label">{label}</span>
                            </button>
                        ))}
                    </div>

                    {/* ── Sub tabs (Motor / Configurações) */}
                    <div className="ap-tabs">
                        {['coletadas', 'pendentes', 'aprovadas', 'publicadas'].map(key => (
                            <button key={key} className={`ap-tab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>
                                {TABS.find(t => t.key === key)?.label}
                            </button>
                        ))}
                        <button className={`ap-tab${tab === 'editorial' ? ' active' : ''}`} onClick={() => setTab('editorial')}>Motor Editorial</button>
                        <button className={`ap-tab${tab === 'templates' ? ' active' : ''}`} onClick={() => setTab('templates')}>Templates</button>
                        <button className={`ap-tab${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>Configurações</button>
                    </div>
                </div>

                {/* ── Content */}
                {tab === 'editorial' && <EditorialEngine clienteId={clienteId} />}
                {tab === 'templates' && <AutoPublisherTemplates clienteId={clienteId} />}
                {tab === 'settings' && <AutoPublisherSettings clienteId={clienteId} />}

                {/* ── Coletadas (leitura-only, tabela simples) */}
                {tab === 'coletadas' && (
                    loading ? <SkeletonTable rows={5} cols={4} /> :
                        items.length === 0 ? <EmptyStatePremium /> : (
                            <div className="ap-table-container">
                                <table className="ap-table">
                                    <thead>
                                        <tr>
                                            <th>Matéria</th>
                                            <th style={{ width: 130 }}>Status</th>
                                            <th style={{ width: 100 }}>Formato</th>
                                            <th style={{ width: 150 }}>Coletada em</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map(item => (
                                            <tr key={item.id}>
                                                <td style={{ fontWeight: 500, color: '#0f172a' }}>{item.titulo}</td>
                                                <td><StatusBadge status={item.status} /></td>
                                                <td><FormatBadge type={item.content_type} /></td>
                                                <td style={{ fontSize: 12, color: '#94a3b8' }}>
                                                    {new Date(item.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )
                )}

                {/* ── Pendentes (cards com Studio + Aprovar p/IG) */}
                {tab === 'pendentes' && (
                    loading ? (
                        <div className="ap-cards-grid">
                            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
                        </div>
                    ) : items.length === 0 ? <EmptyStatePremium /> : (
                        <div className="ap-cards-grid">
                            {items.map(item => (
                                <PendenteCard
                                    key={item.id}
                                    item={item}
                                    onReject={handleReject}
                                    onStudio={handleStudio}
                                    onApproveSelected={handleApproveSelected}
                                    onEdit={handleEditOpen}
                                    isProcessing={isProcessing}
                                />
                            ))}
                        </div>
                    )
                )}

                {/* ── Aprovadas (cards com Baixar Arte, Copiar Legenda, Publicar) */}
                {tab === 'aprovadas' && (
                    loading ? (
                        <div className="ap-cards-grid">
                            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
                        </div>
                    ) : items.length === 0 ? <EmptyStatePremium /> : (
                        <div className="ap-cards-grid">
                            {items.map(item => (
                                <AprovadaCard
                                    key={item.id}
                                    item={item}
                                    onPublish={handlePublish}
                                    onReject={handleReject}
                                    onEdit={handleEditOpen}
                                    isProcessing={isProcessing}
                                />
                            ))}
                        </div>
                    )
                )}

                {/* ── Publicadas (tabela somente leitura) */}
                {tab === 'publicadas' && (
                    loading ? <SkeletonTable rows={5} cols={4} /> :
                        items.length === 0 ? <EmptyStatePremium /> : (
                            <div className="ap-table-container">
                                <table className="ap-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: 100 }}>Arte</th>
                                            <th>Matéria</th>
                                            <th style={{ width: 100 }}>Formato</th>
                                            <th style={{ width: 160 }}>Publicada em</th>
                                            <th style={{ width: 60, textAlign: 'center' }}>IG</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map(item => (
                                            <tr key={item.id}>
                                                <td>
                                                    {item.render_url ? (
                                                        <a href={item.render_url} target="_blank" rel="noreferrer">
                                                            <img src={item.render_url} alt="" style={{ width: 80, height: 45, objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0' }} />
                                                        </a>
                                                    ) : <span style={{ color: '#94a3b8', fontSize: 12 }}>Sem arte</span>}
                                                </td>
                                                <td>
                                                    <div style={{ fontWeight: 500, color: '#0f172a' }}>{item.headline ?? item.titulo}</div>
                                                    {item.caption && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.caption}</div>}
                                                </td>
                                                <td><FormatBadge type={item.content_type} /></td>
                                                <td style={{ fontSize: 12, color: '#94a3b8' }}>
                                                    {item.horario_agendado
                                                        ? new Date(item.horario_agendado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                                                        : new Date(item.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {item.instagram_post_id ? (
                                                        <a href={`https://www.instagram.com/p/${item.instagram_post_id}`} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)' }}>
                                                            <Rss size={14} />
                                                        </a>
                                                    ) : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )
                )}
            </div>

            {/* ── Modal Nova Matéria */}
            {isManualModalOpen && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div className="ap-modal-content" style={{ background: '#ffffff', padding: '0', borderRadius: '20px', width: '560px', maxWidth: '100%', boxShadow: '0 24px 48px rgba(0,0,0,0.15)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', flexShrink: 0 }}>
                            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111827', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div style={{ background: '#eff6ff', color: '#3b82f6', padding: '8px', borderRadius: '10px', display: 'flex' }}><Brain size={18} /></div>
                                Nova Matéria
                            </h2>
                            <button onClick={() => { setManualModalOpen(false); setSelectedFile(null); setFormData({ url_original: '', titulo: '', conteudo: '', image_url: '', context_tag: '', content_type: 'feed', template_set: 'default' }) }} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', color: '#6b7280', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <X size={18} />
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', padding: '20px', gap: '20px', overflowY: 'auto', flex: 1, maxHeight: '75vh', boxSizing: 'border-box' }}>
                            <form onSubmit={submitManualNews} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {/* Formato */}
                                <div style={{ display: 'flex', gap: '12px', background: '#f1f5f9', padding: '6px', borderRadius: '16px' }}>
                                    {[['feed', 'Estático (Feed)', <ImageIcon size={18} />], ['reels', 'Vídeo (Reels)', <Video size={18} />]].map(([val, lbl, icon]) => (
                                        <button key={val} type="button" onClick={() => setFormData({ ...formData, content_type: val })}
                                            style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: formData.content_type === val ? '#fff' : 'transparent', color: formData.content_type === val ? '#0f172a' : '#64748b', fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: formData.content_type === val ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', cursor: 'pointer' }}>
                                            {icon} {lbl}
                                        </button>
                                    ))}
                                </div>

                                {/* Campanha */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <label style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>Campanha</label>
                                    <select
                                        value={formData.template_set || 'default'}
                                        onChange={(e) => setFormData({ ...formData, template_set: e.target.value })}
                                        style={{ width: '100%', padding: '12px 16px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '14px', color: '#0f172a', fontWeight: 500, outline: 'none', transition: 'all 0.2s', appearance: 'none' }}
                                    >
                                        <option value="default">Padrão</option>
                                        <option value="individuais">Individuais</option>
                                        <option value="natal">Natal</option>
                                        <option value="ano_novo">Ano Novo</option>
                                        <option value="dia_das_mulheres">Dia das Mulheres</option>
                                        <option value="dia_dos_pais">Dia dos Pais</option>
                                    </select>
                                </div>

                                {/* Template Individual */}
                                {formData.template_set === 'individuais' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <label style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>Template Individual</label>
                                        <select
                                            value={formData.placid_template_uuid || ''}
                                            onChange={(e) => {
                                                setFormData({ ...formData, placid_template_uuid: e.target.value });
                                                if (manualFormErrors.placid_template_uuid) setManualFormErrors({ ...manualFormErrors, placid_template_uuid: null });
                                            }}
                                            style={{
                                                width: '100%',
                                                padding: '12px 16px',
                                                borderRadius: '12px',
                                                border: manualFormErrors.placid_template_uuid ? '1px solid #ef4444' : '1px solid #e2e8f0',
                                                background: '#f8fafc',
                                                fontSize: '14px',
                                                color: '#0f172a',
                                                fontWeight: 500,
                                                outline: 'none',
                                                transition: 'all 0.2s',
                                                appearance: 'none',
                                                boxShadow: manualFormErrors.placid_template_uuid ? '0 0 0 2px rgba(239, 68, 68, 0.2)' : 'none'
                                            }}
                                        >
                                            <option value="">Selecione um template...</option>
                                            {availableTemplates.map(t => (
                                                <option key={t.id} value={t.placid_template_uuid}>{t.nome}</option>
                                            ))}
                                        </select>
                                        {manualFormErrors.placid_template_uuid && <span style={{ color: '#ef4444', fontSize: '12px', fontWeight: 600 }}>{manualFormErrors.placid_template_uuid}</span>}
                                    </div>
                                )}

                                {/* Link */}
                                <div style={{ padding: '16px', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '8px', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Motor de IA (Link)</label>
                                    <p style={{ margin: 0, fontSize: '13px', color: '#0369a1' }}>Cole um link para a IA extrair o contexto e gerar os textos automaticamente.</p>
                                    <input
                                        value={formData.url_original}
                                        onChange={e => {
                                            setFormData({ ...formData, url_original: e.target.value });
                                            if (manualFormErrors.url_original) setManualFormErrors({ ...manualFormErrors, url_original: null });
                                        }}
                                        placeholder="https://g1.globo.com/exemplo..."
                                        style={{
                                            width: '100%',
                                            padding: '14px',
                                            borderRadius: '10px',
                                            border: manualFormErrors.url_original ? '1px solid #ef4444' : '1px solid #7dd3fc',
                                            boxShadow: manualFormErrors.url_original ? '0 0 0 2px rgba(239, 68, 68, 0.2)' : 'none',
                                            fontSize: '15px',
                                            outline: 'none',
                                            backgroundColor: '#fff',
                                            boxSizing: 'border-box',
                                            transition: 'all 0.2s'
                                        }}
                                    />
                                    {manualFormErrors.url_original && <span style={{ color: '#ef4444', fontSize: '12px', fontWeight: 600 }}>{manualFormErrors.url_original}</span>}
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', opacity: 0.6 }}>
                                    <div style={{ height: '1px', background: '#cbd5e1', flex: 1 }}></div>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Ou crie manualmente</span>
                                    <div style={{ height: '1px', background: '#cbd5e1', flex: 1 }}></div>
                                </div>

                                {/* Título */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Título Principal</label>
                                    <input
                                        value={formData.titulo}
                                        onChange={e => {
                                            setFormData({ ...formData, titulo: e.target.value });
                                            if (manualFormErrors.titulo) setManualFormErrors({ ...manualFormErrors, titulo: null });
                                        }}
                                        placeholder="Prefeito anuncia nova ponte na cidade..."
                                        style={{
                                            width: '100%',
                                            padding: '14px',
                                            borderRadius: '12px',
                                            border: manualFormErrors.titulo ? '1px solid #ef4444' : '1px solid #cbd5e1',
                                            boxShadow: manualFormErrors.titulo ? '0 0 0 2px rgba(239, 68, 68, 0.2)' : 'none',
                                            fontSize: '15px',
                                            outline: 'none',
                                            backgroundColor: '#fff',
                                            boxSizing: 'border-box',
                                            transition: 'all 0.2s'
                                        }}
                                    />
                                    {manualFormErrors.titulo && <span style={{ color: '#ef4444', fontSize: '12px', fontWeight: 600 }}>{manualFormErrors.titulo}</span>}
                                </div>

                                {/* Conteúdo */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Detalhes Adicionais</label>
                                    <textarea
                                        value={formData.conteudo}
                                        onChange={e => {
                                            setFormData({ ...formData, conteudo: e.target.value });
                                            if (manualFormErrors.conteudo) setManualFormErrors({ ...manualFormErrors, conteudo: null });
                                        }}
                                        placeholder="Cole o release ou o corpo do texto aqui..."
                                        rows={4}
                                        style={{
                                            width: '100%',
                                            padding: '14px',
                                            borderRadius: '12px',
                                            border: manualFormErrors.conteudo ? '1px solid #ef4444' : '1px solid #cbd5e1',
                                            boxShadow: manualFormErrors.conteudo ? '0 0 0 2px rgba(239, 68, 68, 0.2)' : 'none',
                                            fontSize: '15px',
                                            outline: 'none',
                                            resize: 'vertical',
                                            minHeight: '80px',
                                            boxSizing: 'border-box',
                                            transition: 'all 0.2s'
                                        }}
                                    />
                                    {manualFormErrors.conteudo && <span style={{ color: '#ef4444', fontSize: '12px', fontWeight: 600 }}>{manualFormErrors.conteudo}</span>}
                                </div>

                                {/* Tag */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Tag de Editoria</label>
                                    <input
                                        value={formData.context_tag}
                                        onChange={e => {
                                            setFormData({ ...formData, context_tag: e.target.value.toUpperCase() });
                                            if (manualFormErrors.context_tag) setManualFormErrors({ ...manualFormErrors, context_tag: null });
                                        }}
                                        maxLength={20}
                                        placeholder="Ex: URGENTE"
                                        style={{
                                            width: '100%',
                                            padding: '14px',
                                            borderRadius: '12px',
                                            border: manualFormErrors.context_tag ? '1px solid #ef4444' : '1px solid #cbd5e1',
                                            boxShadow: manualFormErrors.context_tag ? '0 0 0 2px rgba(239, 68, 68, 0.2)' : 'none',
                                            fontSize: '15px',
                                            outline: 'none',
                                            backgroundColor: '#fff',
                                            boxSizing: 'border-box',
                                            transition: 'all 0.2s'
                                        }}
                                    />
                                    {manualFormErrors.context_tag && <span style={{ color: '#ef4444', fontSize: '12px', fontWeight: 600 }}>{manualFormErrors.context_tag}</span>}
                                </div>

                                {/* Foto (feed only) */}
                                {formData.content_type === 'feed' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', boxSizing: 'border-box' }}>
                                        <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Foto (Fundo do Card)</label>
                                        <div
                                            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                                            onDragLeave={() => setIsDragging(false)}
                                            onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files && e.dataTransfer.files[0]) { setSelectedFile(e.dataTransfer.files[0]); setFormData({ ...formData, image_url: '' }) } }}
                                            style={{ border: isDragging ? '2px dashed #3b82f6' : '2px dashed #cbd5e1', borderRadius: '12px', padding: '20px 16px', textAlign: 'center', background: isDragging ? '#eff6ff' : '#f8fafc', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
                                            onClick={() => document.getElementById('manual-file-upload').click()}
                                        >
                                            <input id="manual-file-upload" type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files && e.target.files[0]) { setSelectedFile(e.target.files[0]); setFormData({ ...formData, image_url: '' }) } }} />
                                            {selectedFile ? (
                                                <div style={{ background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <CheckCircle2 size={16} /> {selectedFile.name}
                                                </div>
                                            ) : (
                                                <>
                                                    <div style={{ background: '#e2e8f0', width: '40px', height: '40px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <UploadCloud size={20} color="#64748b" />
                                                    </div>
                                                    <span style={{ fontSize: '14px', color: '#475569', fontWeight: 500 }}>Clique ou arraste a imagem aqui</span>
                                                </>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.6 }}>
                                            <div style={{ height: '1px', background: '#cbd5e1', flex: 1 }}></div>
                                            <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>OU URL</span>
                                            <div style={{ height: '1px', background: '#cbd5e1', flex: 1 }}></div>
                                        </div>
                                        <input
                                            value={formData.image_url}
                                            onChange={e => {
                                                setFormData({ ...formData, image_url: e.target.value });
                                                if (e.target.value) setSelectedFile(null);
                                                if (manualFormErrors.image_url) setManualFormErrors({ ...manualFormErrors, image_url: null });
                                            }}
                                            placeholder="https://exemplo.com/foto.jpg"
                                            style={{
                                                width: '100%',
                                                padding: '14px',
                                                borderRadius: '12px',
                                                border: manualFormErrors.image_url ? '1px solid #ef4444' : '1px solid #cbd5e1',
                                                boxShadow: manualFormErrors.image_url ? '0 0 0 2px rgba(239, 68, 68, 0.2)' : 'none',
                                                fontSize: '15px',
                                                outline: 'none',
                                                backgroundColor: '#fff',
                                                boxSizing: 'border-box',
                                                transition: 'all 0.2s'
                                            }}
                                        />
                                        {manualFormErrors.image_url && <span style={{ color: '#ef4444', fontSize: '12px', fontWeight: 600 }}>{manualFormErrors.image_url}</span>}
                                    </div>
                                )}

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}>
                                    <button type="submit" disabled={isSubmittingManual} style={{ width: '100%', background: '#111827', color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: isSubmittingManual ? 'not-allowed' : 'pointer', opacity: isSubmittingManual ? 0.7 : 1 }}>
                                        {isSubmittingManual ? 'Gerando...' : 'Gerar Matéria'}
                                    </button>
                                    <button type="button" onClick={() => { setManualModalOpen(false); setSelectedFile(null) }} style={{ background: 'transparent', color: '#64748b', border: 'none', padding: '16px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                                        Cancelar
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Modal Edição de Matéria */}
            {editModalOpen && editingItem && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div className="ap-modal-content" style={{ background: '#ffffff', padding: '0', borderRadius: '20px', width: '560px', maxWidth: '100%', boxShadow: '0 24px 48px rgba(0,0,0,0.15)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', flexShrink: 0 }}>
                            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111827', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div style={{ background: '#f5f3ff', color: '#8b5cf6', padding: '8px', borderRadius: '10px', display: 'flex' }}><Pencil size={18} /></div>
                                Editar Matéria
                            </h2>
                            <button onClick={() => { setEditModalOpen(false); setEditingItem(null) }} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', color: '#6b7280', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <X size={18} />
                            </button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', padding: '20px', gap: '20px', overflowY: 'auto', flex: 1, maxHeight: '75vh', boxSizing: 'border-box' }}>
                            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Tag de Editoria</label>
                                    <input value={editForm.context_tag} onChange={e => setEditForm({ ...editForm, context_tag: e.target.value.toUpperCase() })} maxLength={20} required style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }} />
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Headline (Texto do Card)</label>
                                    <input value={editForm.headline} onChange={e => setEditForm({ ...editForm, headline: e.target.value })} required style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }} />
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Legenda (Caption)</label>
                                    <textarea value={editForm.caption} onChange={e => setEditForm({ ...editForm, caption: e.target.value })} rows={5} required style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', resize: 'vertical', minHeight: '100px', boxSizing: 'border-box' }} />
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Foto (Upload ou URL)</label>
                                    <div
                                        onDragOver={e => { e.preventDefault(); setIsEditDragging(true) }}
                                        onDragLeave={() => setIsEditDragging(false)}
                                        onDrop={e => { e.preventDefault(); setIsEditDragging(false); if (e.dataTransfer.files && e.dataTransfer.files[0]) { setEditSelectedFile(e.dataTransfer.files[0]); setEditForm({ ...editForm, imagem_url: '' }) } }}
                                        style={{ border: isEditDragging ? '2px dashed #8b5cf6' : '2px dashed #cbd5e1', borderRadius: '12px', padding: '16px', textAlign: 'center', background: isEditDragging ? '#f5f3ff' : '#f8fafc', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}
                                        onClick={() => document.getElementById('edit-file-upload').click()}
                                    >
                                        <input id="edit-file-upload" type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files && e.target.files[0]) { setEditSelectedFile(e.target.files[0]); setEditForm({ ...editForm, imagem_url: '' }) } }} />
                                        {editSelectedFile ? (
                                            <div style={{ background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <CheckCircle2 size={16} /> {editSelectedFile.name}
                                            </div>
                                        ) : (
                                            <>
                                                <div style={{ background: '#e2e8f0', width: '36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <UploadCloud size={18} color="#64748b" />
                                                </div>
                                                <span style={{ fontSize: '13px', color: '#475569', fontWeight: 500 }}>Upload de Arquivo (Clique ou Arraste)</span>
                                            </>
                                        )}
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.6 }}>
                                        <div style={{ height: '1px', background: '#cbd5e1', flex: 1 }}></div>
                                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b' }}>OU</span>
                                        <div style={{ height: '1px', background: '#cbd5e1', flex: 1 }}></div>
                                    </div>

                                    {!editSelectedFile && (
                                        <input value={editForm.imagem_url} onChange={e => setEditForm({ ...editForm, imagem_url: e.target.value })} placeholder="URL da imagem (ex: https://site.com/foto.jpg)" style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }} />
                                    )}
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}>
                                    <button type="submit" disabled={isSavingEdit} style={{ width: '100%', background: '#8b5cf6', color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: isSavingEdit ? 'not-allowed' : 'pointer', opacity: isSavingEdit ? 0.7 : 1 }}>
                                        {isSavingEdit ? 'Salvando...' : 'Salvar Alterações'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}

// ──────────────────────────────────────────────────────────
// PendenteCard — Matérias em "selected" aguardando aprovação
// ──────────────────────────────────────────────────────────
function PendenteCard({ item, onReject, onStudio, onApproveSelected, onEdit, isProcessing }) {
    const [isExpanded, setIsExpanded] = useState(false)
    const [isApprovingLocal, setIsApprovingLocal] = useState(false)

    const isStudio = item.status === 'studio_selected' || item.status === 'studio_ready'

    const handleApprove = async () => {
        setIsApprovingLocal(true)
        try {
            await onApproveSelected(item)
        } finally {
            setIsApprovingLocal(false)
        }
    }

    return (
        <div className="ap-review-card insta-mock" style={{ maxWidth: '400px', margin: '0 auto', paddingBottom: '16px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #efefef' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(45deg, #f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img src="/tvgmulti-logo.jpg" style={{ width: 24, height: 24, borderRadius: '50%' }} alt="Avatar" />
                        </div>
                    </div>
                    <div>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#262626' }}>tvgmulti</span>
                        <div style={{ fontSize: '11px', color: '#8e8e8e', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                            {item.context_tag && <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{item.context_tag} •</span>}
                            <StatusBadge status={item.status} small />
                            {item.content_type === 'reels' && <span style={{ marginLeft: '4px', padding: '1px 5px', background: '#ede9fe', color: '#6d28d9', borderRadius: '4px', fontSize: '10px', fontWeight: 700, border: '1px solid #ddd6fe', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><Video size={9} />REELS</span>}
                        </div>
                    </div>
                </div>
                <MoreVertical size={16} color="#262626" />
            </div>

            {/* Imagem */}
            <div className="ap-card-img-wrap" style={{ aspectRatio: '4/5', width: '100%', background: '#fafafa', position: 'relative' }}>
                {(item.render_url || item.imagem_storage || item.imagem_url || item.studio_media_image_url) ? (
                    <img
                        className="ap-card-img"
                        src={
                            item.render_url ??
                            (item.imagem_storage ? supabase.storage.from('ap-images').getPublicUrl(item.imagem_storage).data.publicUrl : null) ??
                            item.imagem_url ??
                            item.studio_media_image_url
                        }
                        alt=""
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8 }}>
                        <ImageIcon size={32} color="#dbdbdb" />
                    </div>
                )}
            </div>

            {/* Ações Insta */}
            <div style={{ padding: '12px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '16px' }}>
                    <Heart size={24} color="#262626" />
                    <MessageCircle size={24} color="#262626" />
                    <Send size={24} color="#262626" />
                </div>
                <Bookmark size={24} color="#262626" />
            </div>

            {/* Caption */}
            <div className="ap-card-body" style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                <p style={{ fontSize: '13px', margin: 0 }}>
                    <span style={{ fontWeight: 600, color: '#262626', marginRight: '6px' }}>tvgmulti</span>
                    {item.headline ?? item.titulo}
                </p>

                {/* Roteiro Studio */}
                {isStudio && item.roteiro_studio && (
                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#262626', background: '#f5f5f5', padding: '12px', borderRadius: '4px', borderLeft: '3px solid #1c1c1e' }}>
                        <div style={{ fontWeight: 600, marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Roteiro Teleprompter:</span><span>~{item.duracao_estimada}s</span>
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>{item.roteiro_studio}</div>
                        {item.broll_sugestao && <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #e0e0e0', color: '#555', fontStyle: 'italic' }}><span style={{ fontWeight: 600, color: '#000' }}>B-Roll:</span> {item.broll_sugestao}</div>}
                    </div>
                )}

                {/* Caption */}
                {item.caption && !isStudio && (
                    <>
                        <p style={{ fontSize: '13px', color: '#262626', margin: '4px 0 0 0', display: isExpanded ? 'block' : '-webkit-box', WebkitLineClamp: isExpanded ? 'initial' : 3, WebkitBoxOrient: 'vertical', overflow: isExpanded ? 'visible' : 'hidden' }}>
                            {item.caption}
                        </p>
                        {item.caption.length > 100 && (
                            <button onClick={() => setIsExpanded(!isExpanded)} style={{ background: 'none', border: 'none', padding: 0, color: '#8e8e8e', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', marginTop: '2px' }}>
                                {isExpanded ? 'Ver menos' : '... mais'}
                            </button>
                        )}
                    </>
                )}
            </div>

            {/* Botões de ação */}
            <div className="ap-card-actions-wrap">
                <div className="ap-card-btn-row">
                    <button className="ap-btn-reject" onClick={() => onReject(item)} title="Descartar" style={{ flexShrink: 0 }}>
                        <X size={16} />
                    </button>
                    <button onClick={() => onEdit(item)} disabled={isProcessing} title="Editar Matéria" style={{ padding: '0 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '13px' }}>
                        <Pencil size={14} /> Editar
                    </button>
                    <button className="ap-card-btn-black" onClick={() => onStudio(item)} disabled={isProcessing}>
                        <Video size={14} /> Studio
                    </button>
                    <button className="ap-card-btn-primary" onClick={handleApprove} disabled={isProcessing || isApprovingLocal}>
                        {isApprovingLocal ? <Loader2 size={14} className="ap-spin-icon" /> : null}
                        {isApprovingLocal ? 'Aprovando...' : 'Aprovar'}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ──────────────────────────────────────────────────────────
// AprovadaCard — Matérias prontas, aguardam publicação manual
// ──────────────────────────────────────────────────────────
function AprovadaCard({ item, onPublish, onReject, onEdit, isProcessing }) {
    const [copied, setCopied] = useState(false)
    const [isExpanded, setIsExpanded] = useState(false)

    // True if Placid hasn't returned the URL yet
    const isRendering = item.status === 'pending_render' || (item.status === 'pending_review' && !item.render_url)

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
            const response = await fetch(url)
            if (!response.ok) throw new Error('Falha HTTP ao baixar')

            const blob = await response.blob()
            let ext = '.bin'
            if (blob.type === 'image/jpeg') ext = '.jpg'
            else if (blob.type === 'image/png') ext = '.png'
            else if (blob.type === 'video/mp4') ext = '.mp4'
            else if (blob.type === 'image/webp') ext = '.webp'
            else {
                const match = url.match(/\.([a-z0-9]+)(?:[\?#]|$)/i);
                if (match) ext = `.${match[1].toLowerCase()}`;
            }

            const blobUrl = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = blobUrl
            a.download = `tvg_noticia_${item.id.slice(0, 6)}${ext}`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
        } catch (err) {
            if (url.includes('/storage/v1/object/')) {
                toast.success('Forçando download direto...')
                const separator = url.includes('?') ? '&' : '?';
                const downloadUrl = `${url}${separator}download=`;
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = '';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            } else {
                toast.error('Erro ao baixar mídia. Abrindo link...')
                window.open(url, '_blank')
            }
        }
    }

    return (
        <div className="ap-review-card insta-mock" style={{ maxWidth: '400px', margin: '0 auto', paddingBottom: '16px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #efefef' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(45deg, #f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <img src="/tvgmulti-logo.jpg" style={{ width: 24, height: 24, borderRadius: '50%' }} alt="Avatar" />
                        </div>
                    </div>
                    <div>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#262626' }}>tvgmulti</span>
                        <div style={{ fontSize: '11px', color: '#8e8e8e', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            {item.context_tag && <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}>{item.context_tag} •</span>}
                            <span style={{ padding: '1px 6px', borderRadius: '4px', background: '#dcfce7', color: '#166534', fontSize: '10px', fontWeight: 700 }}>PRONTA</span>
                            {item.content_type === 'reels' && <span style={{ padding: '1px 5px', background: '#ede9fe', color: '#6d28d9', borderRadius: '4px', fontSize: '10px', fontWeight: 700, border: '1px solid #ddd6fe', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><Video size={9} />REELS</span>}
                        </div>
                    </div>
                </div>
                <MoreVertical size={16} color="#262626" />
            </div>

            {/* Imagem */}
            <div className="ap-card-img-wrap" style={{ aspectRatio: '4/5', width: '100%', background: '#fafafa', position: 'relative' }}>
                {(item.render_url || item.imagem_storage || item.imagem_url || item.studio_media_image_url) ? (
                    <img className="ap-card-img" src={item.render_url ?? (item.imagem_storage ? supabase.storage.from('ap-images').getPublicUrl(item.imagem_storage).data.publicUrl : null) ?? item.imagem_url ?? item.studio_media_image_url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8 }}>
                        <ImageIcon size={32} color="#dbdbdb" />
                        {isRendering && <span style={{ fontSize: 12, color: '#94a3b8' }}>Renderizando...</span>}
                    </div>

                )}
            </div>

            {/* Ações Insta */}
            <div style={{ padding: '12px 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '16px' }}>
                    <Heart size={24} color="#262626" />
                    <MessageCircle size={24} color="#262626" />
                    <Send size={24} color="#262626" />
                </div>
                <Bookmark size={24} color="#262626" />
            </div>

            {/* Caption */}
            <div className="ap-card-body" style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                <p style={{ fontSize: '13px', margin: 0 }}>
                    <span style={{ fontWeight: 600, color: '#262626', marginRight: '6px' }}>tvgmulti</span>
                    {item.headline ?? item.titulo}
                </p>
                {item.caption && (
                    <>
                        <p style={{ fontSize: '13px', color: '#262626', margin: '4px 0 0 0', display: isExpanded ? 'block' : '-webkit-box', WebkitLineClamp: isExpanded ? 'initial' : 3, WebkitBoxOrient: 'vertical', overflow: isExpanded ? 'visible' : 'hidden' }}>
                            {item.caption}
                        </p>
                        {item.caption.length > 100 && (
                            <button onClick={() => setIsExpanded(!isExpanded)} style={{ background: 'none', border: 'none', padding: 0, color: '#8e8e8e', fontSize: '12px', fontWeight: 600, cursor: 'pointer', textAlign: 'left', marginTop: '2px' }}>
                                {isExpanded ? 'Ver menos' : '... mais'}
                            </button>
                        )}
                    </>
                )}
            </div>

            {/* Alerta de Renderização */}
            {isRendering && (
                <div style={{ margin: '12px 16px', padding: '10px', background: '#fef9c3', borderRadius: '8px', fontSize: '12px', color: '#854d0e', fontWeight: 600, textAlign: 'center', border: '1px solid #fde047' }}>
                    ⏳ Em renderização — aguarde a arte ficar pronta
                </div>
            )}

            {/* Botões: Baixar Arte + Copiar Legenda */}
            <div className="ap-card-actions-wrap">
                <div className="ap-card-btn-row">
                    <button className="ap-btn-reject" onClick={() => onReject(item)} title="Descartar" disabled={isRendering || isProcessing} style={{ flexShrink: 0, padding: '8px' }}>
                        <X size={16} />
                    </button>
                    <button onClick={() => onEdit(item)} disabled={isRendering || isProcessing} title="Editar Matéria" style={{ padding: '0 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '12px' }}>
                        <Pencil size={12} /> Editar
                    </button>
                    <button className="ap-card-btn-secondary" onClick={handleDownload} disabled={isRendering} title="Baixar Arte" style={{ fontSize: '12px', padding: '0 10px' }}>
                        <Download size={12} /> Baixar
                    </button>
                    <button className={`ap-card-btn-copy${copied ? ' copied' : ''}`} onClick={handleCopy} title="Copiar Legenda" style={{ fontSize: '12px', padding: '0 10px' }}>
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? 'Copiar' : 'Copiar'}
                    </button>
                </div>
            </div>

            {/* Botão Publicar */}
            <div className="ap-card-actions-wrap" style={{ paddingTop: 0 }}>
                <button
                    onClick={() => onPublish(item)}
                    disabled={isRendering}
                    style={{ width: '100%', margin: '0 16px', boxSizing: 'border-box', padding: '12px', borderRadius: '10px', border: 'none', background: '#111827', color: '#fff', fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: isRendering ? 'not-allowed' : 'pointer', opacity: isRendering ? 0.5 : 1, transition: 'opacity 0.2s' }}
                >
                    <Check size={16} /> Publicar
                </button>
            </div>
        </div>
    )
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────
function StatusBadge({ status, small }) {
    const map = {
        raw: { label: 'Ingerida', bg: '#f1f5f9', color: '#475569' },
        ready_for_scoring: { label: 'Aguardando Score', bg: '#fef9c3', color: '#854d0e' },
        scored: { label: 'Analisada', bg: '#dbeafe', color: '#1e40af' },
        selected: { label: 'Selecionada', bg: '#ede9fe', color: '#6d28d9' },
        pending_render: { label: 'Renderizando', bg: '#fef9c3', color: '#854d0e' },
        processing: { label: 'IA Gerando', bg: '#f5f3ff', color: '#6d28d9' },
        pending_review: { label: 'Pronta', bg: '#dcfce7', color: '#166534' },
        ready_to_publish: { label: 'Pronta', bg: '#dcfce7', color: '#166534' },
        approved: { label: 'Aprovada', bg: '#dcfce7', color: '#166534' },
        queued_for_posting: { label: 'Na Fila', bg: '#e0f2fe', color: '#0369a1' },
        posted: { label: 'Publicada', bg: '#dcfce7', color: '#166534' },
        failed: { label: 'Falhou', bg: '#fee2e2', color: '#991b1b' },
        rejected: { label: 'Descartada', bg: '#f1f5f9', color: '#6b7280' },
    }
    const { label, bg, color } = map[status] || { label: status, bg: '#f1f5f9', color: '#475569' }
    return (
        <span style={{ padding: small ? '1px 6px' : '3px 10px', borderRadius: '20px', fontSize: small ? '10px' : '11px', fontWeight: 700, background: bg, color, letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
            {label}
        </span>
    )
}

function FormatBadge({ type }) {
    const isReels = type === 'reels'
    return (
        <span style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: isReels ? '#ede9fe' : '#f1f5f9', color: isReels ? '#6d28d9' : '#475569', border: isReels ? '1px solid #ddd6fe' : '1px solid #e2e8f0', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            {isReels ? <><Video size={10} />Reels</> : <><ImageIcon size={10} />Feed</>}
        </span>
    )
}

function EmptyStatePremium() {
    return (
        <div className="ap-empty">
            <div className="ap-empty-icon"><Info size={20} /></div>
            <p className="ap-empty-title">Nenhum Registro</p>
            <p className="ap-empty-sub">A fila se encontra vazia no momento.</p>
        </div>
    )
}
