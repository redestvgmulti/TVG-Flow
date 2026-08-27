import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import '../../styles/AutoPublisher.css'
import {
    Rss, RefreshCcw, Check, X, Copy, Download,
    ImageIcon, Zap, Info, MoreVertical, Brain, Heart, MessageCircle, Send, Bookmark, Plus, UploadCloud, Link2,
    Video, CheckCircle2, ChevronDown, ChevronUp, Pencil, Loader2, AlertTriangle
} from 'lucide-react'
import AutoPublisherSettings from './AutoPublisherSettings'
import AutoPublisherTemplates from './AutoPublisherTemplates'
import { SkeletonCard, SkeletonTable } from '../../components/Skeleton'
import { toast } from 'sonner'
import ArticleWizard from '../../components/editorial/ArticleWizard'
import NewsBacklogPanel from '../../components/editorial/NewsBacklogPanel'
import CollectedNewsPanel from '../../components/editorial/CollectedNewsPanel'
import Modal from '../../components/ui/Modal'
import CreatorSignature from '../../components/ui/CreatorSignature'
import {
    availableContentTypes,
    availableVisualModelsForFormat,
    visualModelOptionsForFormat,
} from '../../services/visualModels'
import { resolveOperationalClienteId } from '../../services/visualTitleGroups'
import { editorialTagFromVisualTitleId, flattenVisualTitleGroups, loadVisualTitleCatalog } from '../../services/visualTitleCatalog'
import {
    loadMasterRuntime,
    MASTER_RUNTIME_STATUS,
    visualModelsBlockMessage,
    visualModelsStateFor,
} from '../../services/masterRuntime'
import {
    composerFormErrors,
    composerRequiresSourceImage,
    EMPTY_TERRITORIAL_CATALOG,
    loadTerritorialComposer,
    TERRITORIAL_COMPOSER_STATUS,
    territorialComposerIntent,
    territorialVisualTitleId,
} from '../../services/territorialComposer'

// ──────────────────────────────────────────────────────────
// Tab config
const TABS = [
    { key: 'coletadas', label: 'Coletadas' },
    { key: 'pendentes', label: 'Pendentes' },
    { key: 'aprovadas', label: 'Aprovadas' },
    { key: 'publicadas', label: 'Publicadas' },
]

// Status DB → tab mapping
const STATUS_TAB = {
    raw: 'pendentes',
    ready_for_scoring: 'pendentes',
    scored: 'pendentes',
    selected: 'pendentes',
    pending_render: 'aprovadas',
    processing: 'aprovadas',
    pending_review: 'pendentes',
    ready_to_publish: 'aprovadas',
    render_complete: 'aprovadas',
    approved: 'aprovadas',
    queued_for_posting: 'aprovadas',
    studio_selected: 'pendentes',
    studio_ready: 'pendentes',
    posted: 'publicadas',
    failed: 'pendentes',
    rejected: 'pendentes',
}

// ──────────────────────────────────────────────────────────
export default function AutoPublisher() {
    const [clienteId, setClienteId] = useState(null)
    const [clienteError, setClienteError] = useState('')

    // Tab lives in the URL (/admin/autopublisher/:tab) so the sidebar's
    // AutoPublisher dropdown can deep-link into Banco de Matérias, Templates
    // and Configurações. Motor Editorial was absorbed into Configurações —
    // old bookmarks/links to the "editorial" tab redirect there.
    const { tab: tabParam } = useParams()
    const navigate = useNavigate()
    const tab = tabParam === 'editorial' ? 'settings' : (tabParam || 'pendentes')
    const setTab = useCallback((nextTab) => navigate(`/admin/autopublisher/${nextTab}`), [navigate])

    useEffect(() => {
        if (tabParam === 'editorial') navigate('/admin/autopublisher/settings', { replace: true })
    }, [tabParam, navigate])
    const [tabCounts, setTabCounts] = useState({})
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(false)
    const [ingestionEnabled, setIngestionEnabled] = useState(true)
    const [isProcessing, setIsProcessing] = useState(false)

    // Manual Input State
    const [isManualModalOpen, setManualModalOpen] = useState(false)
    const [manualSubmitSucceeded, setManualSubmitSucceeded] = useState(false)
    const [formData, setFormData] = useState({
        url_original: '',
        titulo: '',
        conteudo: '',
        image_url: '',
        content_type: 'feed',
        source_mode: 'link',
        visual_title_id: null,
        visual_model: '',
        composer_mode: '',
        region_id: null,
        city_id: null,
        manual_slots: [],
        backlog_id: null,
        idempotency_key: null
    })
    const [visualTitleGroups, setVisualTitleGroups] = useState([])
    const [visualTitlesLoading, setVisualTitlesLoading] = useState(false)
    const [visualTitlesError, setVisualTitlesError] = useState('')
    const [masterRuntime, setMasterRuntime] = useState({
        configs: [],
        killSwitch: false,
        poolCounts: {},
        status: MASTER_RUNTIME_STATUS.IDLE,
    })
    const [territorialComposer, setTerritorialComposer] = useState({
        enabled: false,
        status: TERRITORIAL_COMPOSER_STATUS.IDLE,
        catalog: EMPTY_TERRITORIAL_CATALOG,
        error: '',
    })
    const [manualFormErrors, setManualFormErrors] = useState({})
    const [isSubmittingManual, setIsSubmittingManual] = useState(false)
    const [selectedFile, setSelectedFile] = useState(null)

    // Edit Item State
    const [editingItem, setEditingItem] = useState(null)
    const [editModalOpen, setEditModalOpen] = useState(false)
    const [editForm, setEditForm] = useState({ headline: '', caption: '', imagem_url: '' })
    const [isSavingEdit, setIsSavingEdit] = useState(false)
    const [editSelectedFile, setEditSelectedFile] = useState(null)
    useEffect(() => {
        let active = true
        resolveOperationalClienteId(supabase)
            .then(id => { if (active) setClienteId(id) })
            .catch(error => { if (active) setClienteError(error.message) })
        return () => { active = false }
    }, [])

    const [isEditDragging, setIsEditDragging] = useState(false)



    // Shared by "Fechar" (closes the modal) and "Criar outra matéria" (keeps
    // it open so the wizard restarts at step 1 for a new submission).
    function resetManualForm() {
        setFormData({
            url_original: '',
            titulo: '',
            conteudo: '',
            image_url: '',
            content_type: 'feed',
            source_mode: 'link',
            visual_title_id: null,
            visual_model: '',
            composer_mode: '',
            region_id: null,
            city_id: null,
            manual_slots: [],
            backlog_id: null,
            idempotency_key: null
        })
        setSelectedFile(null)
        setManualFormErrors({})
        setManualSubmitSucceeded(false)
    }

    function resetManualModal() {
        setManualModalOpen(false)
        resetManualForm()
    }

    function handleCreateAnother() {
        resetManualForm()
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
        const [{ data }, { data: collectedCounts }] = await Promise.all([
            supabase.schema('ap').from('candidate_news').select('status').eq('cliente_id', clienteId),
            supabase.schema('ap').rpc('get_collected_news_counts', { p_cliente_id: clienteId }),
        ])
        const counts = { coletadas: 0, pendentes: 0, aprovadas: 0, publicadas: 0 }
        for (const row of data ?? []) {
            const mapped = STATUS_TAB[row.status] || 'coletadas'
            counts[mapped] = (counts[mapped] ?? 0) + 1
        }
        counts.coletadas = Number(collectedCounts?.pending_review || 0)
        setTabCounts(counts)
    }, [clienteId])

    // ── Fetch items for current tab
    const fetchItems = useCallback(async (currentTab) => {
        if (!clienteId) return
        setLoading(true)

        let statuses = []
        if (currentTab === 'pendentes') statuses = ['raw', 'ready_for_scoring', 'scored', 'selected', 'studio_selected', 'studio_ready', 'pending_review', 'failed', 'rejected']
        if (currentTab === 'aprovadas') statuses = ['pending_render', 'processing', 'render_complete', 'ready_to_publish', 'approved', 'queued_for_posting']
        if (currentTab === 'publicadas') statuses = ['posted']

        if (statuses.length === 0) {
            setItems([])
            setLoading(false)
            return
        }

        const { data, error } = await supabase
            .schema('ap')
            .from('candidate_news')
            .select(`id, titulo, headline, caption, render_url, imagem_url, imagem_storage,
                     status, created_at, context_tag, content_type, fonte_id,
                     criado_por_user_id, creator_name_snapshot,
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

    const loadAvailableVisualTitles = useCallback(async () => {
        if (!clienteId) return
        setVisualTitlesLoading(true)
        setVisualTitlesError('')
        try {
            setVisualTitleGroups(await loadVisualTitleCatalog(supabase, clienteId))
        } catch (error) {
            console.error('[AutoPublisher] visual title catalog failed', error)
            setVisualTitleGroups([])
            setVisualTitlesError('N\u00e3o foi poss\u00edvel carregar os selos da mat\u00e9ria.')
        } finally {
            setVisualTitlesLoading(false)
        }
    }, [clienteId])

    useEffect(() => {
        if (!isManualModalOpen || !clienteId) return
        const timeoutId = window.setTimeout(loadAvailableVisualTitles, 0)
        return () => window.clearTimeout(timeoutId)
    }, [clienteId, isManualModalOpen, loadAvailableVisualTitles])

    const loadAvailableTerritorialComposer = useCallback(async () => {
        if (!isManualModalOpen || !clienteId) return
        setTerritorialComposer({
            enabled: true,
            status: TERRITORIAL_COMPOSER_STATUS.LOADING,
            catalog: EMPTY_TERRITORIAL_CATALOG,
            error: '',
        })
        try {
            const result = await loadTerritorialComposer(supabase, clienteId)
            setTerritorialComposer({ ...result, error: '' })
        } catch (error) {
            console.error('[AutoPublisher] TERRITORIAL_COMPOSER_READ_FAILED')
            setTerritorialComposer({
                enabled: true,
                status: TERRITORIAL_COMPOSER_STATUS.ERROR,
                catalog: EMPTY_TERRITORIAL_CATALOG,
                error: error?.message || 'N\u00e3o foi poss\u00edvel carregar o compositor territorial.',
            })
        }
    }, [clienteId, isManualModalOpen])

    useEffect(() => {
        const timeoutId = window.setTimeout(loadAvailableTerritorialComposer, 0)
        return () => window.clearTimeout(timeoutId)
    }, [loadAvailableTerritorialComposer])

    const loadAvailableMasterRuntime = useCallback(async () => {
        if (!isManualModalOpen || !clienteId) return
        setMasterRuntime(previous => ({
            ...previous,
            configs: [],
            status: MASTER_RUNTIME_STATUS.LOADING,
        }))
        try {
            const runtime = await loadMasterRuntime(supabase, clienteId)
            setMasterRuntime({ ...runtime, status: MASTER_RUNTIME_STATUS.READY })
        } catch {
            console.error('[AutoPublisher] MASTER_CONFIG_READ_FAILED')
            setMasterRuntime({
                configs: [],
                killSwitch: false,
                poolCounts: {},
                status: MASTER_RUNTIME_STATUS.ERROR,
            })
        }
    }, [clienteId, isManualModalOpen])

    // Load the fixed master matrix every time the manual modal opens.
    useEffect(() => {
        const timeoutId = window.setTimeout(loadAvailableMasterRuntime, 0)
        return () => window.clearTimeout(timeoutId)
    }, [loadAvailableMasterRuntime])

    // Each (cliente, content_type, visual_model) row is one fixed Placid
    // template. The operator picks the model; the template and the sponsor count
    // follow from it. A model is offered only when its master config exists, is
    // enabled and complete, with the kill switch off.
    const runtimeControl = useMemo(
        () => ({ kill_switch: masterRuntime.killSwitch }),
        [masterRuntime.killSwitch],
    )
    const availableVisualModels = useMemo(
        () => availableVisualModelsForFormat(
            masterRuntime.configs,
            runtimeControl,
            formData.content_type,
            masterRuntime.poolCounts,
        ),
        [masterRuntime, formData.content_type, runtimeControl],
    )
    const visualModelOptions = useMemo(
        () => visualModelOptionsForFormat(
            masterRuntime.configs,
            runtimeControl,
            formData.content_type,
            masterRuntime.poolCounts,
        ),
        [masterRuntime, formData.content_type, runtimeControl],
    )
    const legacyAvailableFormats = useMemo(
        () => availableContentTypes(
            masterRuntime.configs,
            runtimeControl,
            masterRuntime.poolCounts,
        ),
        [masterRuntime, runtimeControl],
    )
    const availableFormats = territorialComposer.enabled
        ? territorialComposer.catalog.available_formats
        : legacyAvailableFormats
    const selectedVisualModel = availableVisualModels.find(
        model => model.slug === formData.visual_model,
    )
    const sourceImageRequired = territorialComposer.enabled
        ? composerRequiresSourceImage(territorialComposer.catalog, formData.content_type)
        : selectedVisualModel?.sourceImage === 'required'
    const visualModelsState = visualModelsStateFor(
        masterRuntime.status,
        availableVisualModels,
    )

    // ── Load on tab change + realtime
    useEffect(() => {
        if (!clienteId) return
        const timeoutId = window.setTimeout(() => {
            fetchSystemConfig()
            fetchCounts()
            fetchItems(tab)
        }, 0)

        const channel = supabase
            .channel('autopublisher-realtime')
            .on('postgres_changes', { event: '*', schema: 'ap', table: 'candidate_news' }, () => {
                fetchCounts()
                fetchItems(tab)
            })
            .subscribe()

        return () => {
            window.clearTimeout(timeoutId)
            supabase.removeChannel(channel)
        }
    }, [clienteId, tab, fetchCounts, fetchItems, fetchSystemConfig])

    // ── Actions
    async function handleReject(item) {
        // Optimistic UI update for instant feedback
        setItems(prev => prev.filter(i => i.id !== item.id))

        try {
            const { error } = await supabase.schema('ap').from('candidate_news').update({ status: 'rejected' }).eq('id', item.id)
            if (error) throw error
            fetchCounts()
        } catch {
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
        } catch {
            toast.error("Falha ao gerar roteiro do estúdio.")
        }
        setIsProcessing(false)
        fetchItems(tab); fetchCounts()
    }

    async function handleApproveSelected(item) {
        const canPrepareRender = item.status === 'selected'
        const canApproveReview = item.status === 'pending_review'
        if (!canPrepareRender && !canApproveReview) return

        // Part 2 - Frontend Validation
        if (item.content_type === 'feed' && !item.imagem_url && !item.imagem_storage && !item.render_url) {
            toast.error("Erro: Matérias de Feed exigem uma imagem antes da aprovação.");
            return;
        }

        setIsProcessing(true)
        try {
            // Selected material is prepared for render; only a rendered item in
            // pending_review can use the human approval action.
            const { data, error: prodError } = await supabase.functions.invoke('ap-content-production', {
                body: {
                    action: canPrepareRender ? 'process_selected' : 'approve_for_ig',
                    newsId: item.id
                }
            })
            if (prodError) throw prodError
            if (data?.errors && data.errors.length > 0) throw new Error(data.errors[0].error || "Erro na edge function")

            // Status is now 'pending_render' — the ap-render-engine cron worker
            // will pick it up automatically. Do NOT invoke render directly:
            // that would bypass idempotency guards and cause duplicate renders.
            toast.success(canPrepareRender
                ? "Matéria enviada para renderização. Ela ficará pendente de revisão quando a arte estiver pronta."
                : "Matéria aprovada para publicação.")
        } catch {
            toast.error("Falha ao aprovar matéria.")
        }
        setIsProcessing(false)
        fetchItems(tab); fetchCounts()
    }

    function handleEditOpen(item) {
        setEditingItem(item)
        setEditForm({
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
                headline: editForm.headline.trim(),
                caption: editForm.caption.trim(),
                imagem_url: editingItem.content_type === 'reels' ? null : finalImageUrl
            }
            const { error } = await supabase.schema('ap').from('candidate_news')
                .update(payload)
                .eq('id', editingItem.id)
                .in('status', ['raw', 'ready_for_scoring', 'scored', 'selected', 'pending_review'])
            if (error) throw error

            // Optimistic UI update
            setItems(prev => prev.map(i => i.id === editingItem.id ? { ...i, ...payload } : i))

            toast.success("Edição salva com sucesso!")
            setEditModalOpen(false)
            setEditingItem(null)
            fetchCounts()
        } catch {
            toast.error("Erro ao salvar edição.")
        }
        setIsSavingEdit(false)
    }

    async function handlePublish(item) {
        await supabase.schema('ap').from('candidate_news').update({ status: 'posted' }).eq('id', item.id)
        toast.success("Matéria marcada como publicada!")
        fetchItems(tab); fetchCounts()
    }

    // ── Manual submission (Hybrid Editorial Engine)
    async function submitManualNews(e) {
        e.preventDefault()
        if (isSubmittingManual) return;

        if (territorialComposer.enabled && territorialComposer.status !== TERRITORIAL_COMPOSER_STATUS.READY) {
            toast.error(territorialComposer.error || 'Aguarde o carregamento do compositor territorial.')
            return
        }
        if (!territorialComposer.enabled && visualModelsState !== 'available') {
            const message = visualModelsBlockMessage(visualModelsState) || 'Aguarde o carregamento dos modelos visuais.'
            toast.error(message)
            return
        }

        // 1. Validation Logic
        const newErrors = {}
        const isLinkMode = !!formData.url_original

        if (territorialComposer.enabled) {
            Object.assign(newErrors, composerFormErrors(formData, territorialComposer.catalog))
        } else {
        if (!formData.visual_title_id) {
            newErrors.visual_title_id = 'Selecione o selo da mat\u00e9ria para usar a rota\u00e7\u00e3o de patrocinadores.'
        }

        if (!formData.visual_model) {
            newErrors.visual_model = 'Selecione a finalidade da arte.'
        }
        }

        if (!isLinkMode) {
            // Manual Mode Requirements
            if (!formData.titulo) newErrors.titulo = 'Título obrigatório em modo manual.'
            if (!formData.conteudo) newErrors.conteudo = 'Conteúdo obrigatório em modo manual.'
            if (sourceImageRequired && !formData.image_url && !selectedFile) {
                newErrors.image_url = 'Imagem obrigatória para esta finalidade.'
            }
        }
        // Link mode: título/conteúdo are resolved by the scraper below, no
        // client-side requirement.

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
        } else if (formData.titulo && formData.conteudo) { // Check for identical manual articles
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const { data: existing } = await supabase.schema('ap').from('candidate_news')
                .select('id')
                .eq('cliente_id', clienteId)
                .eq('titulo', formData.titulo)
                .eq('conteudo', formData.conteudo)
                .gte('created_at', twentyFourHoursAgo)
                .limit(1);
            if (existing && existing.length > 0) {
                const dupError = 'Esta mesma matéria já foi submetida nas últimas 24h.'
                setManualFormErrors({ titulo: dupError })
                toast.error(dupError)
                setIsSubmittingManual(false)
                return
            }
        }

        let scrapedTitle = ''
        let scrapedConteudo = ''
        let scrapedImage = ''

        // 3. Scraping (only if link provided and needed)
        if (isLinkMode) {
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
        if (selectedFile && sourceImageRequired) {
            try {
                const fileExt = selectedFile.name.split('.').pop()
                const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${fileExt}`
                const { error: uploadError } = await supabase.storage.from('ap-images').upload(`admin_uploads/${fileName}`, selectedFile)
                if (uploadError) throw uploadError

                const { data: pubData } = supabase.storage.from('ap-images').getPublicUrl(`admin_uploads/${fileName}`)
                finalImageUrl = pubData.publicUrl
            } catch {
                toast.error("Erro ao subir imagem.")
            }
        }

        if (sourceImageRequired && !finalImageUrl) {
            setManualFormErrors({ image_url: 'Imagem obrigatória para esta finalidade.' })
            setIsSubmittingManual(false)
            return
        }

        // 5. Standardized Payload
        const { data: authData } = await supabase.auth.getUser()
        const user = authData?.user
        let finalAuthUserId = user?.id || null
        if (finalAuthUserId === 'null') finalAuthUserId = null

        const selectedVisualTitleId = territorialComposer.enabled
            ? territorialVisualTitleId(formData, territorialComposer.catalog)
            : formData.visual_title_id
        const visualTitles = territorialComposer.enabled
            ? territorialComposer.catalog.visual_titles
            : flattenVisualTitleGroups(visualTitleGroups)
        const basePayload = {
            cliente_id: clienteId,
            auth_user_id: finalAuthUserId,
            url_original: formData.url_original || null,
            headline: formData.titulo || scrapedTitle || 'Pauta OMNI',
            text: formData.conteudo || scrapedConteudo || '',
            context_tag: editorialTagFromVisualTitleId(visualTitles, selectedVisualTitleId),
            content_type: formData.content_type || 'feed',
            source_image: sourceImageRequired ? finalImageUrl : null,
            backlog_id: formData.backlog_id || null,
        }

        const idempotencyKey = formData.idempotency_key || crypto.randomUUID()
        if (!formData.idempotency_key) setFormData(previous => ({ ...previous, idempotency_key: idempotencyKey }))
        const payload = territorialComposer.enabled
            ? { ...basePayload, ...territorialComposerIntent(formData), idempotency_key: idempotencyKey }
            : {
                ...basePayload,
                visual_title_id: formData.visual_title_id || null,
                visual_model: formData.visual_model,
                idempotency_key: idempotencyKey,
            }

        try {
            const { error } = await supabase.functions.invoke('ap-employee-generator', { body: payload })
            if (error) {
                let message = error.message
                if (error.context) {
                    try {
                        const errBody = await error.context.json()
                        if (errBody?.error === 'INTERNAL_ERROR' && errBody.correlation_id) {
                            message = `Não foi possível gerar a matéria. Código de suporte: ${errBody.correlation_id}`
                        } else if (errBody?.message) {
                            message = errBody.message
                        }
                    } catch (parseError) {
                        console.error('Failed to parse ap-employee-generator error:', parseError)
                    }
                }
                throw new Error(message)
            }

            toast.success("Matéria enviada para processamento!")
            setManualSubmitSucceeded(true)
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
                    <div className="ap-header">
                        <div className="ap-header-id">
                            <span className="ap-title-mark"><Rss size={16} /></span>
                            <h1 className="ap-header-title">AutoPublisher</h1>
                            <span className={`ap-badge-live${ingestionEnabled ? '' : ' off'}`}>
                                {ingestionEnabled ? 'Motor Ativo' : 'Desativado'}
                            </span>
                        </div>

                        <div className="ap-header-actions">
                            <label
                                className="ap-ingest"
                                title={ingestionEnabled ? 'Pausar ingestão automática' : 'Retomar ingestão automática'}
                            >
                                <input
                                    type="checkbox"
                                    checked={ingestionEnabled}
                                    onChange={toggleIngestion}
                                />
                                <span className="ap-ingest-track" />
                                Ingestão
                            </label>

                            <button
                                className="ap-btn-refresh"
                                onClick={() => {
                                    fetchCounts()
                                    fetchItems(tab)
                                }}
                            >
                                <RefreshCcw size={14} />
                                Atualizar
                            </button>

                            <button
                                className="ap-btn-refresh primary"
                                onClick={() => setManualModalOpen(true)}
                            >
                                <Plus size={14} />
                                Nova Matéria
                            </button>
                        </div>
                    </div>

                    <div className="ap-nav">
                        <div
                            className="ap-seg"
                            role="tablist"
                            aria-label="Estágios do pipeline"
                        >
                            <span
                                className="ap-seg-pill"
                                style={{
                                    left: `calc(3px + ${Math.max(
                                        0,
                                        ['coletadas', 'pendentes', 'aprovadas', 'publicadas'].indexOf(tab)
                                    )} * (100% - 6px) / 4)`,
                                    opacity: ['coletadas', 'pendentes', 'aprovadas', 'publicadas'].includes(tab)
                                        ? 1
                                        : 0
                                }}
                            />

                            {['coletadas', 'pendentes', 'aprovadas', 'publicadas'].map(key => (
                                <button
                                    key={key}
                                    role="tab"
                                    aria-selected={tab === key}
                                    className={`ap-seg-btn${tab === key ? ' active' : ''}`}
                                    onClick={() => setTab(key)}
                                >
                                    {TABS.find(item => item.key === key)?.label}
                                    <span className="ap-seg-count">
                                        {tabCounts[key] ?? 0}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Content */}
                {tab === 'backlog' && <NewsBacklogPanel
                    clienteId={clienteId}
                    onStartProduction={(item) => {
                        setFormData(previous => ({
                            ...previous,
                            url_original: item.url_original,
                            titulo: item.titulo || '',
                            conteudo: '',
                            source_mode: 'link',
                            backlog_id: item.id,
                            idempotency_key: null,
                        }))
                        setManualModalOpen(true)
                    }}
                />}
                {tab === 'templates' && <AutoPublisherTemplates clienteId={clienteId} />}
                {tab === 'settings' && <AutoPublisherSettings clienteId={clienteId} clienteError={clienteError} />}

                {tab === 'coletadas' && (
                    <CollectedNewsPanel
                        clienteId={clienteId}
                        onCountsChange={counts => setTabCounts(previous => ({
                            ...previous,
                            coletadas: Number(counts?.pending_review || 0),
                        }))}
                    />
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
                                            <th style={{ width: 210 }}>Criada por</th>
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
                                                            {item.render_url.toLowerCase().includes('.mp4') ? (
                                                                <video src={item.render_url} style={{ width: 80, height: 45, objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0' }} preload="metadata" muted playsInline />
                                                            ) : (
                                                                <img src={item.render_url} alt="" style={{ width: 80, height: 45, objectFit: 'cover', borderRadius: 6, border: '1px solid #e2e8f0' }} />
                                                            )}
                                                        </a>
                                                    ) : <span style={{ color: '#94a3b8', fontSize: 12 }}>Sem arte</span>}
                                                </td>
                                                <td>
                                                    <div style={{ fontWeight: 500, color: '#0f172a' }}>{item.headline ?? item.titulo}</div>
                                                    {item.caption && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.caption}</div>}
                                                </td>
                                                <td><FormatBadge type={item.content_type} /></td>
                                                <td>
                                                    <CreatorSignature
                                                        name={item.creator_name_snapshot}
                                                        createdAt={item.created_at}
                                                        automated={Boolean(item.fonte_id)}
                                                        compact
                                                    />
                                                </td>
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
            <Modal
                isOpen={isManualModalOpen}
                onClose={resetManualModal}
                title="Nova Matéria"
                icon={Brain}
                size="lg"
                className="ap-new-article-modal"
            >
                <ArticleWizard
                    formData={formData}
                    setFormData={data => {
                        setFormData(data);
                        // Optionally clear errors here if mapped
                        setManualFormErrors({});
                    }}
                    errors={manualFormErrors}
                    onSubmit={submitManualNews}
                    isSubmitting={isSubmittingManual}
                    onCancel={resetManualModal}
                    availableVisualModels={availableVisualModels}
                    visualModelOptions={visualModelOptions}
                    availableFormats={availableFormats}
                    visualTitleGroups={visualTitleGroups}
                    visualTitlesLoading={visualTitlesLoading}
                    visualTitlesError={visualTitlesError}
                    onRetryVisualTitles={loadAvailableVisualTitles}
                    visualModelsState={visualModelsState}
                    onRetryVisualModels={loadAvailableMasterRuntime}
                    territorialComposerEnabled={territorialComposer.enabled}
                    territorialCatalog={territorialComposer.catalog}
                    territorialComposerState={territorialComposer.status}
                    territorialComposerError={territorialComposer.error}
                    onRetryTerritorialComposer={loadAvailableTerritorialComposer}
                    selectedFile={selectedFile}
                    setSelectedFile={setSelectedFile}
                    submitSucceeded={manualSubmitSucceeded}
                    onCreateAnother={handleCreateAnother}
                />
            </Modal>

            {/* ── Modal Edição de Matéria */}
            <Modal
                isOpen={editModalOpen && !!editingItem}
                onClose={() => { setEditModalOpen(false); setEditingItem(null) }}
                title="Editar Matéria"
                icon={Pencil}
                iconColor="#8b5cf6"
                iconBg="#f5f3ff"
                size="lg"
            >
                {editingItem && (
                            <form onSubmit={handleSaveEdit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Headline (Texto do Card)</label>
                                    <input value={editForm.headline} onChange={e => setEditForm({ ...editForm, headline: e.target.value })} required style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }} />
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Legenda (Caption)</label>
                                    <textarea value={editForm.caption} onChange={e => setEditForm({ ...editForm, caption: e.target.value })} rows={5} required style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', resize: 'vertical', minHeight: '100px', boxSizing: 'border-box' }} />
                                </div>

                                {editingItem.content_type !== 'reels' && (
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
                                )}

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}>
                                    <button type="submit" disabled={isSavingEdit} style={{ width: '100%', background: '#8b5cf6', color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: isSavingEdit ? 'not-allowed' : 'pointer', opacity: isSavingEdit ? 0.7 : 1 }}>
                                        {isSavingEdit ? 'Salvando...' : 'Salvar Alterações'}
                                    </button>
                                </div>
                            </form>
                )}
            </Modal>
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
        <div className="ap-review-card insta-mock" style={{ maxWidth: '400px', margin: '0 auto', paddingBottom: '16px', border: (item.content_type === 'feed' && !item.imagem_url && !item.imagem_storage && !item.render_url) ? '2px solid #ef4444' : '' }}>
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
                            <StatusBadge status={item.status} small errorLog={item.error_log} />
                            <div style={{ marginLeft: '4px' }}>
                                <FormatBadge type={item.content_type} />
                            </div>
                        </div>
                    </div>
                </div>
                <MoreVertical size={16} color="#262626" />
            </div>

            {/* Part 3 - Dashboard Visual Alert */}
            {(item.content_type === 'feed' && !item.imagem_url && !item.imagem_storage && !item.render_url && !['pending_render', 'processing', 'generating'].includes(item.status)) && (
                <div style={{ padding: '6px 12px', background: '#fee2e2', color: '#ef4444', fontSize: '11px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', borderBottom: '1px solid #fca5a5' }}>
                    <AlertTriangle size={14} /> Erro: Post de Feed sem Imagem
                </div>
            )}

            {/* Imagem */}
            <div className="ap-card-img-wrap" style={{ aspectRatio: '4/5', width: '100%', background: '#fafafa', position: 'relative' }}>
                {(() => {
                    const finalUrl = item.render_url ?? (item.imagem_storage ? supabase.storage.from('ap-images').getPublicUrl(item.imagem_storage).data.publicUrl : null) ?? item.imagem_url ?? item.studio_media_image_url;
                    if (!finalUrl) {
                        return (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8 }}>
                                <ImageIcon size={32} color="#dbdbdb" />
                            </div>
                        );
                    }
                    if (finalUrl && finalUrl.toLowerCase().includes('.mp4')) {
                        return (
                            <video className="ap-card-img" src={finalUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} autoPlay loop muted playsInline />
                        );
                    }
                    return (
                        <img className="ap-card-img" src={finalUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    );
                })()}
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

            <div style={{ padding: '10px 16px 0' }}>
                <CreatorSignature
                    name={item.creator_name_snapshot}
                    createdAt={item.created_at}
                    automated={Boolean(item.fonte_id)}
                    compact
                />
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
                        {isApprovingLocal ? (item.status === 'selected' ? 'Preparando...' : 'Aprovando...') : (item.status === 'selected' ? 'Gerar arte' : 'Aprovar')}
                    </button>
                </div>
            </div>
        </div>
    )
}

// ──────────────────────────────────────────────────────────
// AprovadaCard — Matérias prontas, aguardam publicação manual
// ──────────────────────────────────────────────────────────
function AprovadaCard({ item, onPublish, onReject, isProcessing }) {
    const [copied, setCopied] = useState(false)
    const [isExpanded, setIsExpanded] = useState(false)

    // True if render is actually active
    const isRendering = item.status === 'pending_render' || item.status === 'processing'
    const isAwaitingReview = item.status === 'pending_review' && !item.render_url

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
                const match = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i);
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
        } catch {
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
                {isRendering ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '12px', background: '#f8fafc' }}>
                        <Loader2 size={40} color="#6366f1" className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} />
                        <span style={{ fontSize: '16px', color: '#334155', fontWeight: 600, textAlign: 'center', padding: '0 20px', lineHeight: '1.4' }}>
                            ⏱️ Gerando design final<br/>
                            <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>(leva ~15s)...</span>
                        </span>
                    </div>
                ) : (() => {
                    const finalUrl = item.render_url ?? (item.imagem_storage ? supabase.storage.from('ap-images').getPublicUrl(item.imagem_storage).data.publicUrl : null) ?? item.imagem_url ?? item.studio_media_image_url;
                    if (!finalUrl) {
                        return (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8 }}>
                                <ImageIcon size={32} color="#dbdbdb" />
                            </div>
                        );
                    }
                    if (finalUrl && finalUrl.toLowerCase().includes('.mp4')) {
                        return (
                            <video className="ap-card-img" src={finalUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} autoPlay loop muted playsInline />
                        );
                    }
                    return (
                        <img className="ap-card-img" src={finalUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    );
                })()}
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

            {/* Alerta de Renderização / Revisão */}
            {isAwaitingReview && (
                <div style={{ margin: '12px 16px', padding: '10px', background: '#fff7ed', borderRadius: '8px', fontSize: '12px', color: '#c2410c', fontWeight: 600, textAlign: 'center', border: '1px solid #fdba74' }}>
                    ⚠️ Aguardando Revisão — clique em Aprovar para renderizar
                </div>
            )}
            
            {item.approved_by_name && ['ready_to_publish', 'approved', 'queued_for_posting', 'posted'].includes(item.status) && (
                <div style={{ padding: '0 16px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#16a34a', fontWeight: 'bold' }}>
                    <Check size={12} /> Aprovado por {item.approved_by_name}
                </div>
            )}

            <div style={{ padding: '2px 16px 10px' }}>
                <CreatorSignature
                    name={item.creator_name_snapshot}
                    createdAt={item.created_at}
                    automated={Boolean(item.fonte_id)}
                    compact
                />
            </div>

            {/* Botões: Baixar Arte + Copiar Legenda */}
            <div className="ap-card-actions-wrap">
                <div className="ap-card-btn-row">
                    <button className="ap-btn-reject" onClick={() => onReject(item)} title="Descartar" disabled={isProcessing} style={{ flexShrink: 0, padding: '8px' }}>
                        <X size={16} />
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
function StatusBadge({ status, small, errorLog }) {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ padding: small ? '1px 6px' : '3px 10px', borderRadius: '20px', fontSize: small ? '10px' : '11px', fontWeight: 700, background: bg, color, letterSpacing: '0.03em', whiteSpace: 'nowrap' }}>
                {label}
            </span>
            {status === 'failed' && errorLog && (
                <div title={errorLog} style={{ cursor: 'help' }}>
                    <AlertTriangle size={small ? 12 : 14} color="#ef4444" />
                </div>
            )}
        </div>
    )
}

function FormatBadge({ type }) {
    const config = {
        feed: { label: 'Feed', icon: <ImageIcon size={10} />, bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' },
        reels: { label: 'Reels', icon: <Video size={10} />, bg: '#ede9fe', color: '#6d28d9', border: '#ddd6fe' },
        carousel: { label: 'Carrossel', icon: <Brain size={10} />, bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
        sponsored: { label: 'Patrocinado', icon: <Zap size={10} />, bg: '#fef3c7', color: '#d97706', border: '#fde68a' },
    }
    const { label, icon, bg, color, border } = config[type] || config.feed
    return (
        <span style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: bg, color, border: `1px solid ${border}`, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            {icon}{label}
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
