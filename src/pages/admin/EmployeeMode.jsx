import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../services/supabase';
import { Check, CheckCircle2, Copy, Download, X, AlertCircle, RefreshCcw, ImageIcon, Brain, Search, SearchCode, Video, Image as ImageIconLucide, Loader2, Share2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import ArticleForm from '../../components/editorial/ArticleForm';
import NewsBacklogPanel from '../../components/editorial/NewsBacklogPanel';
import CreatorSignature from '../../components/ui/CreatorSignature';
import {
    availableContentTypes,
    availableVisualModelsForFormat,
    visualModelOptionsForFormat,
} from '../../services/visualModels';
import { editorialTagFromVisualTitleId, flattenVisualTitleGroups, loadVisualTitleCatalog } from '../../services/visualTitleCatalog';
import {
    loadMasterRuntime,
    MASTER_RUNTIME_STATUS,
    visualModelsBlockMessage,
    visualModelsStateFor,
} from '../../services/masterRuntime';
import {
    composerFormErrors,
    composerRequiresSourceImage,
    EMPTY_TERRITORIAL_CATALOG,
    loadTerritorialComposer,
    TERRITORIAL_COMPOSER_STATUS,
    territorialComposerIntent,
    territorialVisualTitleId,
} from '../../services/territorialComposer';

// Fallback provider client removed - enforce session ID

const createInitialFormData = () => ({
    url_original: '',
    titulo: '',
    conteudo: '',
    content_type: 'feed',
    image_url: '',
    visual_title_id: null,
    visual_model: '',
    source_mode: 'link',
    composer_mode: '',
    region_id: null,
    city_id: null,
    manual_slots: [],
    backlog_id: null,
    idempotency_key: null,
});

function versionedRenderUrl(url, completedAt) {
    if (!url) return null;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}rendered=${encodeURIComponent(completedAt || Date.now())}`;
}

function sourceInputKey(formData, selectedFile) {
    return JSON.stringify({
        mode: formData.source_mode || 'link',
        url: formData.url_original?.trim() || '',
        title: formData.titulo?.trim() || '',
        text: formData.conteudo?.trim() || '',
        image: formData.image_url?.trim() || '',
        file: selectedFile ? `${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}` : '',
    });
}

function validateSource(mode, { url, title, text, hasImage }) {
    if (mode === 'link') {
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
        } catch {
            return 'Informe um link HTTP ou HTTPS válido.';
        }
    }
    if (title.trim().length < 8) return 'A fonte precisa ter um título claro com pelo menos 8 caracteres.';
    if (mode === 'image' && !hasImage) return 'Envie uma imagem para usar o modo Imagem.';
    const minimum = mode === 'image' ? 40 : 5;
    if (text.trim().length < minimum) {
        return mode === 'image'
            ? 'Inclua um briefing factual com pelo menos 40 caracteres.'
            : 'A fonte precisa ter pelo menos 5 caracteres de conteúdo verificável.';
    }
    return '';
}

function materialFileName(type, headline, extension) {
    const slug = String(headline || 'materia')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'materia';
    return `${type === 'reels' ? 'frame' : 'arte'}-${slug}.${extension}`;
}

export default function EmployeeMode({ isOpen, onClose, user: propUser, empresaId }) {
    const { user: ctxUser, professionalId, professionalName } = useAuth();
    const user = propUser || ctxUser;

    const [formData, setFormData] = useState(createInitialFormData);

    const [masterRuntime, setMasterRuntime] = useState({
        configs: [],
        killSwitch: false,
        poolCounts: {},
        status: MASTER_RUNTIME_STATUS.IDLE,
    });
    const [territorialComposer, setTerritorialComposer] = useState({
        enabled: false,
        status: TERRITORIAL_COMPOSER_STATUS.IDLE,
        catalog: EMPTY_TERRITORIAL_CATALOG,
        error: '',
    });
    const [visualTitleGroups, setVisualTitleGroups] = useState([]);
    const [visualTitlesLoading, setVisualTitlesLoading] = useState(false);
    const [visualTitlesError, setVisualTitlesError] = useState('');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [successData, setSuccessData] = useState(null);
    const [renderUrl, setRenderUrl] = useState(null); // Polled render result
    const [isPollingRender, setIsPollingRender] = useState(false);
    const [renderStatus, setRenderStatus] = useState(null);
    const [renderError, setRenderError] = useState('');
    const [sourcePreview, setSourcePreview] = useState(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    // Publication tracking per generated article
    const [actionBaixou, setActionBaixou] = useState(false);
    const [actionCopiou, setActionCopiou] = useState(false);
    const isPublished = actionBaixou && actionCopiou;

    // Multi-tenant resolution
    const [clienteId, setClienteId] = useState(empresaId || null);

    useEffect(() => {
        if (isOpen && professionalId && !empresaId && !clienteId) {
            // Use server-side RPC to resolve agency client ID
            supabase.rpc('get_agencia_cliente_id').then(({ data: id, error }) => {
                if (error) {
                    console.error("[ERROR][EMPRESA_RESOLUTION]", error);
                } else if (id) {
                    setClienteId(id);
                }
            });
        }
    }, [isOpen, professionalId, empresaId, clienteId]);

    const loadAvailableTerritorialComposer = useCallback(async () => {
        if (!isOpen || !clienteId) return;
        setTerritorialComposer({
            enabled: true,
            status: TERRITORIAL_COMPOSER_STATUS.LOADING,
            catalog: EMPTY_TERRITORIAL_CATALOG,
            error: '',
        });
        try {
            const result = await loadTerritorialComposer(supabase, clienteId);
            setTerritorialComposer({ ...result, error: '' });
        } catch (error) {
            console.error('[EmployeeMode] TERRITORIAL_COMPOSER_READ_FAILED');
            setTerritorialComposer({
                enabled: true,
                status: TERRITORIAL_COMPOSER_STATUS.ERROR,
                catalog: EMPTY_TERRITORIAL_CATALOG,
                error: error?.message || 'N\u00e3o foi poss\u00edvel carregar o compositor territorial.',
            });
        }
    }, [isOpen, clienteId]);

    useEffect(() => {
        const timeoutId = window.setTimeout(loadAvailableTerritorialComposer, 0);
        return () => window.clearTimeout(timeoutId);
    }, [loadAvailableTerritorialComposer]);

    const loadAvailableMasterRuntime = useCallback(async () => {
        if (!isOpen || !clienteId) return;
        setMasterRuntime(previous => ({
            ...previous,
            configs: [],
            status: MASTER_RUNTIME_STATUS.LOADING,
        }));
        try {
            const runtime = await loadMasterRuntime(supabase, clienteId);
            setMasterRuntime({ ...runtime, status: MASTER_RUNTIME_STATUS.READY });
        } catch {
            console.error('[EmployeeMode] MASTER_CONFIG_READ_FAILED');
            setMasterRuntime({
                configs: [],
                killSwitch: false,
                poolCounts: {},
                status: MASTER_RUNTIME_STATUS.ERROR,
            });
        }
    }, [isOpen, clienteId]);

    // Load the fixed master matrix every time the modal opens.
    useEffect(() => {
        const timeoutId = window.setTimeout(loadAvailableMasterRuntime, 0);
        return () => window.clearTimeout(timeoutId);
    }, [loadAvailableMasterRuntime]);

    // ── Load the grouped seal catalog every time the modal opens
    useEffect(() => {
        if (!isOpen || !clienteId) return;
        let cancelled = false;
        async function loadTitles() {
            setVisualTitlesLoading(true);
            setVisualTitlesError('');
            try {
                const groups = await loadVisualTitleCatalog(supabase, clienteId);
                if (!cancelled) setVisualTitleGroups(groups);
            } catch (error) {
                console.error('[EmployeeMode] visual title catalog failed', error);
                if (!cancelled) {
                    setVisualTitleGroups([]);
                    setVisualTitlesError('Não foi possível carregar os selos da matéria.');
                }
            } finally {
                if (!cancelled) setVisualTitlesLoading(false);
            }
        }
        loadTitles();
        return () => { cancelled = true };
    }, [isOpen, clienteId]);

    // Each (cliente, content_type, visual_model) row is one fixed Placid
    // template; a model is offered only when its config is enabled and complete.
    const runtimeControl = useMemo(
        () => ({ kill_switch: masterRuntime.killSwitch }),
        [masterRuntime.killSwitch],
    );
    const availableVisualModels = useMemo(
        () => availableVisualModelsForFormat(
            masterRuntime.configs,
            runtimeControl,
            formData.content_type,
            masterRuntime.poolCounts,
        ),
        [masterRuntime, formData.content_type, runtimeControl],
    );
    const visualModelOptions = useMemo(
        () => visualModelOptionsForFormat(
            masterRuntime.configs,
            runtimeControl,
            formData.content_type,
            masterRuntime.poolCounts,
        ),
        [masterRuntime, formData.content_type, runtimeControl],
    );
    const legacyAvailableFormats = useMemo(
        () => availableContentTypes(
            masterRuntime.configs,
            runtimeControl,
            masterRuntime.poolCounts,
        ),
        [masterRuntime, runtimeControl],
    );
    const availableFormats = territorialComposer.enabled
        ? territorialComposer.catalog.available_formats
        : legacyAvailableFormats;
    const selectedVisualModel = availableVisualModels.find(
        model => model.slug === formData.visual_model,
    );
    const sourceImageRequired = territorialComposer.enabled
        ? composerRequiresSourceImage(territorialComposer.catalog, formData.content_type)
        : selectedVisualModel?.sourceImage === 'required';
    const visualModelsState = visualModelsStateFor(
        masterRuntime.status,
        availableVisualModels,
    );

    const applyMaterialRecord = useCallback((record) => {
        if (!record) return false;
        setRenderStatus(record.status || null);
        setSuccessData(previous => previous ? {
            ...previous,
            ...record,
            news_id: record.id || previous.news_id,
            template_nome: record.template_nome_snapshot || previous.template_nome,
            roteiro: record.roteiro_studio || record.roteiro_json || previous.roteiro,
        } : previous);
        setActionBaixou(Boolean(record.acao_baixou));
        setActionCopiou(Boolean(record.acao_copiou));

        if (record.render_url) {
            setRenderUrl(versionedRenderUrl(record.render_url, record.render_completed_at));
            setRenderError('');
            setIsPollingRender(false);
            return true;
        }
        if (record.status === 'failed') {
            setRenderError(record.error_log || 'A arte não pôde ser gerada. Tente criar um novo material.');
            setIsPollingRender(false);
            return true;
        }
        return false;
    }, []);

    // Realtime is the primary completion signal; polling is the bounded
    // fallback for reconnects, suspended tabs, and mobile browsers.
    useEffect(() => {
        if (!isPollingRender || !successData?.news_id || !user?.id) return;

        let cancelled = false;
        let pollTimer;
        let attempts = 0;
        const maxAttempts = 36;
        const topic = `employee-material:${user.id}:${successData.news_id}`;

        const refreshMaterial = async () => {
            if (cancelled) return;
            window.clearTimeout(pollTimer);
            const { data, error } = await supabase
                .from('ap_candidate_news_complete')
                .select('id, status, headline, caption, context_tag, content_type, template_nome_snapshot, render_url, render_completed_at, error_log, roteiro_json, roteiro_studio, acao_baixou, acao_copiou')
                .eq('id', successData.news_id)
                .maybeSingle();

            if (cancelled) return;
            if (error) {
                console.error('[EmployeeMode] MATERIAL_REFRESH_FAILED', error);
            } else if (applyMaterialRecord(data)) {
                return;
            }

            attempts += 1;
            if (attempts >= maxAttempts) {
                setIsPollingRender(false);
                setRenderError('A arte continua em processamento. Você pode atualizar agora ou acompanhar em Meu Histórico.');
                return;
            }
            pollTimer = window.setTimeout(refreshMaterial, 5000);
        };

        const channel = supabase
            .channel(topic, { config: { private: true } })
            .on('broadcast', { event: 'material_changed' }, () => refreshMaterial())
            .subscribe(status => {
                if (status === 'SUBSCRIBED') refreshMaterial();
            });

        pollTimer = window.setTimeout(refreshMaterial, 1500);

        return () => {
            cancelled = true;
            window.clearTimeout(pollTimer);
            supabase.removeChannel(channel);
        };
    }, [applyMaterialRecord, isPollingRender, successData?.news_id, user?.id]);

    // Tab state: 'create' | 'history'
    const [activeTab, setActiveTab] = useState('create');

    // History state
    const [historyItems, setHistoryItems] = useState([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [historyPage, setHistoryPage] = useState(0);
    const [hasMoreHistory, setHasMoreHistory] = useState(true);
    const [copiedHistoryItems, setCopiedHistoryItems] = useState({});
    const ITEMS_PER_PAGE = 20;

    const handleCopyHistory = async (item) => {
        if (!item.caption) return;
        try {
            await navigator.clipboard.writeText(item.caption);
            await markActionInDB(item.id, 'copy');
            setCopiedHistoryItems(prev => ({ ...prev, [item.id]: true }));
            setTimeout(() => {
                setCopiedHistoryItems(prev => ({ ...prev, [item.id]: false }));
            }, 2000);
        } catch (error) {
            console.error('[EmployeeMode] HISTORY_COPY_FAILED', error);
            setErrorMsg('Não foi possível copiar o texto deste material.');
        }
    };

    // File Upload State
    const [selectedFile, setSelectedFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);

    useEffect(() => {
        setSourcePreview(null);
    }, [
        formData.source_mode,
        formData.url_original,
        formData.titulo,
        formData.conteudo,
        formData.image_url,
        selectedFile,
    ]);

    // Upload image to Supabase if file is selected
    const handleFileUpload = async (file) => {
        setIsUploading(true);
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
            const filePath = `employee_uploads/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('ap-images')
                .upload(filePath, file);

            if (uploadError) {
                throw uploadError;
            }

            const { data: { publicUrl } } = supabase.storage
                .from('ap-images')
                .getPublicUrl(filePath);

            return publicUrl;
        } finally {
            setIsUploading(false);
        }
    };

    const handleGenerate = async (e) => {
        if (e) e.preventDefault();
        if (isSubmitting) return;

        const { url_original, titulo, conteudo, image_url, content_type, visual_model, visual_title_id } = formData;
        const sourceMode = formData.source_mode || 'link';

        // Validation based on unified behavior
        if (territorialComposer.enabled && territorialComposer.status !== TERRITORIAL_COMPOSER_STATUS.READY) {
            setErrorMsg(territorialComposer.error || 'Aguarde o carregamento do compositor territorial.');
            return;
        }
        if (!territorialComposer.enabled && visualModelsState !== 'available') {
            setErrorMsg(visualModelsBlockMessage(visualModelsState) || 'Aguarde o carregamento dos modelos visuais.');
            return;
        }
        if (territorialComposer.enabled) {
            const errors = composerFormErrors(formData, territorialComposer.catalog);
            const firstError = Object.values(errors)[0];
            if (firstError) {
                setErrorMsg(firstError);
                return;
            }
        } else {
        if (!visual_model) { setErrorMsg('Selecione a finalidade da arte.'); return; }
        if (!visual_title_id) { setErrorMsg('Selecione o selo da matéria.'); return; }
        }
        if (sourceMode === 'link' && !url_original) {
            setErrorMsg('Informe o link da matéria para analisar a fonte.');
            return;
        }
        if (sourceMode !== 'link' && !titulo && !conteudo) {
            setErrorMsg('Informe o título e os fatos confirmados da matéria.');
            return;
        }

        let currentClienteId = clienteId;

        if (!currentClienteId) {
            setIsSubmitting(true);
            try {
                const { data: empresa_id, error } = await supabase.rpc("get_agencia_cliente_id");

                if (error) {
                    console.error("[ERROR][EMPRESA_RESOLUTION]", error);
                    setErrorMsg("Não foi possível identificar o cliente da agência.");
                    setIsSubmitting(false);
                    return;
                }

                currentClienteId = empresa_id;
                setClienteId(empresa_id);
            } catch {
                setErrorMsg("Erro ao identificar a agência. Tente novamente.");
                setIsSubmitting(false);
                return;
            }
        }

        setIsSubmitting(true);
        setErrorMsg(null);
        setSuccessData(null);

        try {
            if (sourceMode === 'link' && url_original) {
                // Check for duplicates
                const { data: existingNews, error: searchError } = await supabase
                    .from('ap_candidate_news')
                    .select('id')
                    .eq('url_original', url_original)
                    .eq('cliente_id', currentClienteId)
                    .limit(1);

                if (!searchError && existingNews && existingNews.length > 0) {
                    throw new Error(`Esta matéria já foi gerada no sistema por outro usuário. Pautas duplicadas não são permitidas.`);
                }
            } else if (titulo) {
                const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                const { data: existingNews, error: searchError } = await supabase
                    .from('ap_candidate_news')
                    .select('id')
                    .eq('cliente_id', currentClienteId)
                    .ilike('headline', titulo)
                    .gte('created_at', twentyFourHoursAgo)
                    .limit(1);

                if (!searchError && existingNews && existingNews.length > 0) {
                    throw new Error('Uma matéria com este título já foi gerada nas últimas 24h para sua conta.');
                }
            }

            const inputKey = sourceInputKey(formData, selectedFile);
            const reusablePreview = sourcePreview?.inputKey === inputKey ? sourcePreview : null;
            let scrapedTitle = reusablePreview?.resolvedTitle || '';
            let scrapedConteudo = reusablePreview?.resolvedText || '';
            let scrapedImage = reusablePreview?.resolvedImage || '';

            // Auto-Scraping Logic
            if (sourceMode === 'link' && !reusablePreview) {
                const { data, error } = await supabase.functions.invoke('ap-link-scraper', {
                    body: { url: url_original }
                });

                if (error) {
                    throw new Error('Falha ao extrair dados do link. Tente preencher manualmente.');
                }
                scrapedTitle = data.title || '';
                scrapedConteudo = data.content || '';
                scrapedImage = data.image_url || '';
            }

            const resolvedTitle = sourceMode === 'link' ? scrapedTitle : titulo.trim();
            const resolvedText = sourceMode === 'link' ? scrapedConteudo : conteudo.trim();
            const resolvedImage = image_url || scrapedImage || '';
            const sourceError = validateSource(sourceMode, {
                url: url_original,
                title: resolvedTitle,
                text: resolvedText,
                hasImage: Boolean(resolvedImage || selectedFile),
            });
            if (sourceError) throw new Error(sourceError);

            if (!reusablePreview) {
                setSourcePreview({
                    inputKey,
                    title: resolvedTitle,
                    excerpt: resolvedText.slice(0, 260) + (resolvedText.length > 260 ? '…' : ''),
                    contentLength: resolvedText.length,
                    hasImage: Boolean(resolvedImage || selectedFile),
                    resolvedTitle,
                    resolvedText,
                    resolvedImage,
                });
                return;
            }

            let finalImageUrl = resolvedImage || null;
            if (selectedFile && sourceImageRequired) {
                finalImageUrl = await handleFileUpload(selectedFile);
            }

            if (sourceImageRequired && !finalImageUrl) {
                throw new Error('Imagem obrigatória para esta finalidade.');
            }

            // Sanitize professionalId (convert "null" string to null)
            let finalAuthUserId = professionalId || user?.id;
            if (finalAuthUserId === 'null') finalAuthUserId = null;

            const selectedVisualTitleId = territorialComposer.enabled
                ? territorialVisualTitleId(formData, territorialComposer.catalog)
                : visual_title_id;
            const visualTitles = territorialComposer.enabled
                ? territorialComposer.catalog.visual_titles
                : flattenVisualTitleGroups(visualTitleGroups);
            const basePayload = {
                cliente_id: currentClienteId,
                auth_user_id: finalAuthUserId,
                url_original: sourceMode === 'link' ? url_original : null,
                headline: resolvedTitle,
                text: resolvedText,
                context_tag: editorialTagFromVisualTitleId(visualTitles, selectedVisualTitleId),
                content_type: content_type,
                source_image: sourceImageRequired ? finalImageUrl : null,
                source_mode: sourceMode,
                backlog_id: formData.backlog_id || null,
            };

            const idempotencyKey = formData.idempotency_key || crypto.randomUUID();
            if (!formData.idempotency_key) setFormData(previous => ({ ...previous, idempotency_key: idempotencyKey }));
            const payload = territorialComposer.enabled
                ? { ...basePayload, ...territorialComposerIntent(formData), idempotency_key: idempotencyKey }
                : {
                    ...basePayload,
                    visual_title_id: visual_title_id || null,
                    visual_model,
                    idempotency_key: idempotencyKey,
                };

            // Validation and Audit
            if (!payload.cliente_id) {
                throw new Error("cliente_id could not be resolved");
            }

            const { data, error } = await supabase.functions.invoke('ap-employee-generator', {
                body: payload
            });

            if (error) {
                let realErrorMsg = error.message;
                if (error.context) {
                    try {
                        const errBody = await error.context.json();
                        if (errBody?.error === 'INTERNAL_ERROR' && errBody.correlation_id) {
                            realErrorMsg = `Não foi possível gerar a matéria. Código de suporte: ${errBody.correlation_id}`;
                        } else if (errBody?.message) {
                            realErrorMsg = errBody.message;
                        } else if (errBody?.error) {
                            realErrorMsg = errBody.error;
                        }
                    } catch (e) {
                        console.error('Failed to parse edge function error:', e);
                    }
                }
                throw new Error(realErrorMsg || 'Erro de rede na Edge Function');
            }
            if (data?.error === 'INTERNAL_ERROR' && data.correlation_id) {
                throw new Error(`Não foi possível gerar a matéria. Código de suporte: ${data.correlation_id}`);
            }
            if (data?.error) throw new Error(data.error);

            let parsedData = data;
            if (typeof data === 'string') {
                try {
                    parsedData = JSON.parse(data);
                } catch (e) {
                    console.error("Erro ao fazer parse do JSON recebido da Edge Function:", e);
                }
            }

            if (parsedData?.error === 'INTERNAL_ERROR' && parsedData.correlation_id) {
                throw new Error(`Não foi possível gerar a matéria. Código de suporte: ${parsedData.correlation_id}`);
            }
            if (parsedData?.error) throw new Error(parsedData.error);

            setSuccessData(parsedData);
            setSourcePreview(null);
            setRenderStatus(parsedData?.status || null);
            setRenderError('');
            setRenderUrl(versionedRenderUrl(parsedData?.render_url, parsedData?.render_completed_at));
            setActionBaixou(Boolean(parsedData?.downloaded));
            setActionCopiou(Boolean(parsedData?.copied));

            // If render is pending (employee flow), start polling
            setIsPollingRender(Boolean(parsedData?.render_pending && parsedData?.news_id && !parsedData?.render_url));
        } catch (err) {
            setErrorMsg(err.message || 'Erro ao gerar matéria. Verifique os templates ativos.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const markActionInDB = async (newsId, action) => {
        if (!newsId) return null;
        const { data, error } = await supabase
            .schema('ap')
            .rpc('record_employee_material_action', {
                p_candidate_id: newsId,
                p_action: action,
            });
        if (error) throw error;
        if (newsId === successData?.news_id) {
            setActionBaixou(Boolean(data?.downloaded));
            setActionCopiou(Boolean(data?.copied));
        }
        setHistoryItems(previous => previous.map(item => item.id === newsId ? {
            ...item,
            acao_baixou: Boolean(data?.downloaded),
            acao_copiou: Boolean(data?.copied),
        } : item));
        return data;
    };

    const handleCopy = async () => {
        if (!successData?.caption) return;

        let copyText = successData.caption;
        // Removido a concatenação forçada de Roteiro + Legenda para Reels, para manter a legenda "clean" como solicitado.
        // O roteiro continua sendo exibido no modal para consulta se for Reels.

        try {
            await navigator.clipboard.writeText(copyText);
            if (successData?.news_id) {
                await markActionInDB(successData.news_id, 'copy');
            } else {
                setActionCopiou(true);
            }
        } catch (error) {
            console.error('[EmployeeMode] COPY_FAILED', error);
            setErrorMsg('Não foi possível copiar a legenda. Verifique a permissão da área de transferência.');
        }
    };

    const handleDownloadUrl = async (url, type = 'feed', headline = successData?.headline) => {
        if (!url) throw new Error('A arte ainda não está disponível para download.');

        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP_${response.status}`);
            const blob = await response.blob();
            if (!blob.size) throw new Error('EMPTY_FILE');
            const extensionByType = {
                'image/jpeg': 'jpg',
                'image/png': 'png',
                'image/webp': 'webp',
                'video/mp4': 'mp4',
            };
            const extension = extensionByType[blob.type] || 'bin';
            const fileName = materialFileName(type, headline, extension);

            const objUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.setTimeout(() => window.URL.revokeObjectURL(objUrl), 1000);
            return { started: true, fileName, blob };
        } catch (error) {
            console.error('[EmployeeMode] VERIFIED_DOWNLOAD_FAILED', error);
            if (!url.includes('/storage/v1/object/')) throw error;
            const fileName = materialFileName(type, headline, 'png');
            const separator = url.includes('?') ? '&' : '?';
            const link = document.createElement('a');
            link.href = `${url}${separator}download=${encodeURIComponent(fileName)}`;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            return { started: true, fileName, blob: null };
        }
    };

    const handleDownload = async () => {
        const url = renderUrl || successData?.render_url;
        if (!url) {
            setRenderError('A arte ainda não terminou. Atualize o status antes de baixar.');
            setIsPollingRender(Boolean(successData?.news_id));
            return;
        }
        setIsDownloading(true);
        setErrorMsg('');
        try {
            await handleDownloadUrl(url, successData?.content_type);
            if (successData?.news_id) {
                await markActionInDB(successData.news_id, 'download');
            } else {
                setActionBaixou(true);
            }
        } catch (error) {
            console.error('[EmployeeMode] DOWNLOAD_FAILED', error);
            setErrorMsg('Não foi possível iniciar o download da arte. Tente novamente.');
        } finally {
            setIsDownloading(false);
        }
    };

    const handleShare = async () => {
        const url = renderUrl || successData?.render_url;
        if (!url || !navigator.share) return;
        setIsSharing(true);
        setErrorMsg('');
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) throw new Error(`HTTP_${response.status}`);
            const blob = await response.blob();
            if (!blob.size) throw new Error('EMPTY_FILE');
            const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
            const file = new File([blob], materialFileName(successData?.content_type, successData?.headline, extension), { type: blob.type || 'image/png' });
            const shareData = { files: [file], title: successData?.headline || 'Material TVG Flow', text: successData?.caption || '' };
            if (!navigator.canShare?.(shareData)) throw new Error('FILE_SHARE_UNAVAILABLE');
            await navigator.share(shareData);
        } catch (error) {
            if (error?.name !== 'AbortError') {
                console.error('[EmployeeMode] SHARE_FAILED', error);
                setErrorMsg('O compartilhamento direto não está disponível neste dispositivo. Baixe a arte para compartilhar.');
            }
        } finally {
            setIsSharing(false);
        }
    };

    const handleHistoryDownload = async (item) => {
        if (!item.render_url) return;
        try {
            await handleDownloadUrl(
                versionedRenderUrl(item.render_url, item.render_completed_at),
                item.content_type,
                item.headline || item.titulo,
            );
            await markActionInDB(item.id, 'download');
        } catch (error) {
            console.error('[EmployeeMode] HISTORY_DOWNLOAD_FAILED', error);
            setErrorMsg('Não foi possível iniciar o download deste material.');
        }
    };

    const fetchHistory = async (page = 0, append = false) => {
        setIsLoadingHistory(true);
        try {
            const { data, error } = await supabase
                .from('ap_candidate_news_complete')
                .select('id, titulo, headline, caption, render_url, render_completed_at, gerado_em, created_at, status, content_type, acao_baixou, acao_copiou, template_nome_snapshot, context_tag, fonte_id, criado_por_user_id, creator_name_snapshot')
                .eq('criado_por_user_id', user?.id)
                .order('gerado_em', { ascending: false })
                .range(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE - 1);

            if (error) throw error;

            if (data) {
                if (append) {
                    setHistoryItems(prev => [...prev, ...data]);
                } else {
                    setHistoryItems(data);
                }
                setHasMoreHistory(data.length === ITEMS_PER_PAGE);
            }
        } catch (err) {
            console.error("Erro ao carregar histórico:", err);
        } finally {
            setIsLoadingHistory(false);
        }
    };

    // Fetch History when tab changes
    useEffect(() => {
        if (!isOpen || activeTab !== 'history' || !user?.id) return;
        const timeoutId = window.setTimeout(() => {
            setHistoryPage(0);
            fetchHistory(0, false);
        }, 0);
        return () => window.clearTimeout(timeoutId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, activeTab, user]);

    const handleLoadMore = () => {
        const nextPage = historyPage + 1;
        setHistoryPage(nextPage);
        fetchHistory(nextPage, true);
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal employee-mode-modal" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="modal-header">
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', padding: '8px', borderRadius: '10px', display: 'inline-flex' }}><Brain size={18} /></span>
                        Nova Matéria
                    </h3>
                    <button onClick={onClose} className="modal-close" aria-label="Fechar">
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="employee-mode-modal-tabs" style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#fff', padding: '0 20px' }}>
                    <button
                        onClick={() => setActiveTab('create')}
                        style={{ padding: '16px 20px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: activeTab === 'create' ? '#3b82f6' : '#64748b', borderBottom: activeTab === 'create' ? '2px solid #3b82f6' : '2px solid transparent', transition: 'all 0.2s' }}
                    >
                        Criar Conteúdo
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        style={{ padding: '16px 20px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: activeTab === 'history' ? '#3b82f6' : '#64748b', borderBottom: activeTab === 'history' ? '2px solid #3b82f6' : '2px solid transparent', transition: 'all 0.2s' }}
                    >
                        Meu Histórico
                    </button>
                    <button
                        onClick={() => setActiveTab('backlog')}
                        style={{ padding: '16px 20px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: activeTab === 'backlog' ? '#3b82f6' : '#64748b', borderBottom: activeTab === 'backlog' ? '2px solid #3b82f6' : '2px solid transparent', transition: 'all 0.2s' }}
                    >
                        Banco de Matérias
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="employee-mode-modal-body" style={{ display: 'flex', flexDirection: 'column', padding: '20px', gap: '20px', width: '100%', boxSizing: 'border-box' }}>

                    {errorMsg && (
                        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '16px', borderRadius: '12px', marginBottom: '10px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                            <AlertCircle color="#ef4444" size={20} style={{ flexShrink: 0 }} />
                            <span style={{ color: '#991b1b', fontSize: '14px', fontWeight: 500 }}>{errorMsg}</span>
                        </div>
                    )}

                    {activeTab === 'create' && (
                        successData ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', animation: 'fadeIn 0.5s ease-out' }}>

                                <div style={{ background: renderUrl ? '#dcfce7' : '#eff6ff', border: `1px solid ${renderUrl ? '#bbf7d0' : '#bfdbfe'}`, padding: '16px', borderRadius: '12px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                                    {renderUrl ? <CheckCircle2 color="#16a34a" size={24} /> : <Loader2 color="#2563eb" size={24} className={isPollingRender ? 'spin' : ''} />}
                                    <div>
                                        <h3 style={{ margin: 0, fontSize: '15px', color: renderUrl ? '#166534' : '#1d4ed8', fontWeight: 700 }}>
                                            {renderUrl ? 'Material pronto para usar' : 'Conteúdo criado • produzindo a arte'} ({successData.content_type === 'reels' ? 'Reels' : successData.content_type === 'story' ? 'Story' : 'Feed'})
                                        </h3>
                                        <span style={{ fontSize: '13px', color: renderUrl ? '#15803d' : '#3b82f6' }}>
                                            {successData.template_nome ? `Template: ${successData.template_nome}` : `Status: ${renderStatus || successData.status || 'processando'}`}
                                        </span>
                                    </div>
                                </div>

                                <CreatorSignature
                                    name={successData.creator_name || successData.creator_name_snapshot || professionalName || user?.user_metadata?.nome || user?.email}
                                    createdAt={successData.created_at || successData.gerado_em}
                                    compact
                                />

                                {/* Render Zone — shows spinner while polling, card when ready */}
                                {renderUrl ? (
                                    <div style={{ width: '100%', borderRadius: '16px', overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', animation: 'fadeIn 0.5s ease-out' }}>
                                        <img src={renderUrl} alt="Arte Final" style={{ width: '100%', display: 'block', objectFit: 'cover' }} />
                                    </div>
                                ) : isPollingRender ? (
                                    <div style={{ width: '100%', borderRadius: '16px', border: '1px dashed #bae6fd', background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)', padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', boxSizing: 'border-box' }}>
                                        <div style={{ width: 48, height: 48, background: '#3b82f6', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'spin 1.5s linear infinite' }}>
                                            <Loader2 size={24} color="#fff" strokeWidth={2.5} />
                                        </div>
                                        <p style={{ margin: 0, fontSize: '14px', color: '#0284c7', fontWeight: 700, textAlign: 'center' }}>Gerando arte...</p>
                                        <p style={{ margin: 0, fontSize: '12px', color: '#38bdf8', textAlign: 'center' }}>O Placid está renderizando seu card. Aguarde alguns segundos.</p>
                                    </div>
                                ) : renderError ? (
                                    <div style={{ width: '100%', borderRadius: '16px', border: '1px solid #fed7aa', background: '#fff7ed', padding: '28px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', boxSizing: 'border-box' }}>
                                        <AlertCircle size={24} color="#ea580c" />
                                        <p style={{ margin: 0, fontSize: '13px', color: '#9a3412', textAlign: 'center', lineHeight: 1.5 }}>{renderError}</p>
                                        {renderStatus !== 'failed' && (
                                            <button type="button" onClick={() => { setRenderError(''); setIsPollingRender(true); }} style={{ border: '1px solid #fdba74', background: '#fff', color: '#9a3412', borderRadius: '9px', padding: '9px 12px', fontWeight: 600, cursor: 'pointer' }}>
                                                Atualizar status agora
                                            </button>
                                        )}
                                    </div>
                                ) : successData?.pending_review ? (
                                    <div style={{ width: '100%', borderRadius: '16px', border: '1px solid #dcfce7', background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', boxSizing: 'border-box' }}>
                                        <div style={{ width: 48, height: 48, background: '#10b981', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Check size={24} color="#fff" />
                                        </div>
                                        <p style={{ margin: 0, fontSize: '15px', color: '#065f46', fontWeight: 700, textAlign: 'center' }}>Matéria Criada com Sucesso!</p>
                                        <p style={{ margin: 0, fontSize: '13px', color: '#059669', textAlign: 'center', maxWidth: '300px' }}>Estamos gerando a sua arte agora mesmo. Em alguns segundos ela estará pronta para download.</p>
                                    </div>
                                ) : (
                                    <div style={{ width: '100%', borderRadius: '16px', border: '1px dashed #e2e8f0', background: '#f8fafc', padding: '28px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', boxSizing: 'border-box' }}>
                                        <div style={{ width: 48, height: 48, background: '#fee2e2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <AlertCircle size={24} color="#ef4444" />
                                        </div>
                                        <p style={{ margin: 0, fontSize: '14px', color: '#475569', fontWeight: 600, textAlign: 'center', maxWidth: '300px' }}>
                                            A arte foi enviada para a fila de processamento. Ela estará disponível no seu Histórico em alguns instantes.
                                        </p>
                                    </div>
                                )}

                                {/* Content Results */}
                                {successData.content_type === 'reels' && successData.roteiro && (
                                    <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '16px', border: '1px dashed #cbd5e1', position: 'relative' }}>
                                        <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Roteiro Sugerido</h4>
                                        <p style={{ margin: 0, fontSize: '15px', color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                                            {typeof successData.roteiro === 'string' ? successData.roteiro : JSON.stringify(successData.roteiro, null, 2)}
                                        </p>
                                    </div>
                                )}

                                <div style={{ background: '#fff', padding: '16px', borderRadius: '16px', border: '1px solid #e2e8f0', position: 'relative' }}>
                                    <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Legenda Sugerida</h4>
                                    <p style={{ margin: 0, fontSize: '15px', color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                                        {successData.caption}
                                    </p>
                                </div>

                                {/* Action Tracking Bar */}
                                {(actionBaixou || actionCopiou) && !isPublished && (
                                    <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#92400e', fontWeight: 500 }}>
                                        <span>Falta {actionBaixou ? '✓ Arte' : '◦ Arte'} {actionCopiou ? '✓ Legenda / Roteiro' : '◦ Textos'} para publicar</span>
                                    </div>
                                )}
                                {isPublished && (
                                    <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: '10px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px', color: '#166534', fontWeight: 700 }}>
                                        <CheckCircle2 size={18} color="#16a34a" />
                                        Sua matéria foi gerada com sucesso e está pronta para uso!
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
                                    <button onClick={handleDownload} disabled={!renderUrl || isDownloading} style={{ width: '100%', background: actionBaixou ? '#16a34a' : !renderUrl ? '#94a3b8' : '#111827', color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', boxShadow: '0 4px 6px -1px rgba(17, 24, 39, 0.1)', cursor: (!renderUrl || isDownloading) ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}>
                                        {isDownloading ? <Loader2 size={18} className="spin" /> : actionBaixou ? <CheckCircle2 size={18} /> : <Download size={18} />} {isDownloading ? 'Preparando arquivo...' : actionBaixou ? 'Download iniciado' : !renderUrl ? 'Aguardando a arte' : 'Baixar arte em alta qualidade'}
                                    </button>
                                    {renderUrl && typeof navigator.share === 'function' && (
                                        <button onClick={handleShare} disabled={isSharing} style={{ width: '100%', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '14px', borderRadius: '12px', fontSize: '14px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: isSharing ? 'not-allowed' : 'pointer' }}>
                                            {isSharing ? <Loader2 size={18} className="spin" /> : <Share2 size={18} />} {isSharing ? 'Abrindo compartilhamento...' : 'Compartilhar arte e legenda'}
                                        </button>
                                    )}
                                    <button onClick={handleCopy} style={{ width: '100%', background: '#fff', color: actionCopiou ? '#16a34a' : '#111827', border: actionCopiou ? '2px solid #16a34a' : '1px solid #e2e8f0', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer', transition: 'all 0.2s' }}>
                                        {actionCopiou ? <><CheckCircle2 size={18} color="#16a34a" /> Copiado!</> : <><Copy size={18} /> Copiar {successData.content_type === 'reels' ? 'Roteiro e Legenda' : 'Legenda'}</>}
                                    </button>
                                    <button onClick={() => { setSuccessData(null); setFormData(createInitialFormData()); setSelectedFile(null); setSourcePreview(null); setRenderUrl(null); setRenderStatus(null); setRenderError(''); setIsPollingRender(false); }} style={{ background: 'transparent', color: '#64748b', border: 'none', padding: '16px', fontSize: '14px', fontWeight: 600, marginTop: '4px', cursor: 'pointer' }}>

                                        Novo Conteúdo
                                    </button>
                                </div>

                            </div>
                        ) : (
                            <ArticleForm
                                mode="employee"
                                formData={formData}
                                setFormData={setFormData}
                                onSubmit={handleGenerate}
                                isSubmitting={isSubmitting || isUploading}
                                availableVisualModels={availableVisualModels}
                                visualModelOptions={visualModelOptions}
                                availableFormats={availableFormats}
                                visualModelsState={visualModelsState}
                                onRetryVisualModels={loadAvailableMasterRuntime}
                                territorialComposerEnabled={territorialComposer.enabled}
                                territorialCatalog={territorialComposer.catalog}
                                territorialComposerState={territorialComposer.status}
                                territorialComposerError={territorialComposer.error}
                                onRetryTerritorialComposer={loadAvailableTerritorialComposer}
                                visualTitleGroups={visualTitleGroups}
                                visualTitlesLoading={visualTitlesLoading}
                                visualTitlesError={visualTitlesError}
                                selectedFile={selectedFile}
                                setSelectedFile={setSelectedFile}
                                sourcePreview={sourcePreview}
                                onDiscardSourcePreview={() => setSourcePreview(null)}
                            />
                        )
                    )}

                    {activeTab === 'backlog' && (
                        <NewsBacklogPanel
                            clienteId={clienteId}
                            onStartProduction={(item) => {
                                setFormData(previous => ({
                                    ...previous,
                                    source_mode: 'link',
                                    url_original: item.url_original,
                                    titulo: item.titulo || '',
                                    conteudo: '',
                                    image_url: '',
                                    backlog_id: item.id,
                                    idempotency_key: null,
                                }));
                                setSelectedFile(null);
                                setSourcePreview(null);
                                setErrorMsg('');
                                setActiveTab('create');
                            }}
                        />
                    )}

                    {activeTab === 'history' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {isLoadingHistory ? (
                                <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}><RefreshCcw size={24} className="spin" style={{ marginBottom: '10px' }} /><br />Carregando histórico...</div>
                            ) : historyItems.length === 0 ? (
                                <div style={{ textAlign: 'center', background: '#f8fafc', padding: '40px 20px', borderRadius: '12px', border: '1px dashed #cbd5e1', color: '#64748b' }}>
                                    <ImageIcon size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
                                    <h4 style={{ margin: '0 0 4px', color: '#334155' }}>Sem matérias.</h4>
                                    <p style={{ margin: 0, fontSize: '13px' }}>Você ainda não gerou nenhuma matéria com a IA.</p>
                                </div>
                            ) : (
                                historyItems.map(item => (
                                    <div key={item.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                                        {/* Row 1: Image & Basic Info */}
                                        <div style={{ display: 'flex', padding: '16px', gap: '16px', borderBottom: '1px solid #f1f5f9' }}>
                                            {item.render_url ? (
                                                <img src={versionedRenderUrl(item.render_url, item.render_completed_at)} alt="" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #e2e8f0', cursor: 'pointer' }} onClick={() => window.open(versionedRenderUrl(item.render_url, item.render_completed_at), '_blank', 'noopener,noreferrer')} />
                                            ) : ['pending_render', 'processing'].includes(item.status) ? (
                                                <div style={{ width: '80px', height: '80px', background: '#f8fafc', borderRadius: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px dashed #3b82f6' }}>
                                                    <RefreshCcw size={18} color="#3b82f6" className="spin" style={{ marginBottom: '4px' }}/>
                                                    <span style={{ fontSize: '9px', color: '#3b82f6', fontWeight: 600 }}>Na fila</span>
                                                </div>
                                            ) : (
                                                <div style={{ width: '80px', height: '80px', background: '#fef2f2', borderRadius: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '1px solid #fecaca' }}>
                                                    <ImageIcon size={20} color="#ef4444" style={{ marginBottom: '4px' }} />
                                                    <span style={{ fontSize: '9px', color: '#ef4444', fontWeight: 600 }}>Falhou</span>
                                                </div>
                                            )}

                                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                                <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', color: '#1e293b', fontWeight: 600, lineHeight: 1.3 }}>{item.headline || item.titulo || 'Materia Sem Título'}</h4>
                                                <CreatorSignature
                                                    name={item.creator_name_snapshot}
                                                    createdAt={item.gerado_em || item.created_at}
                                                    automated={Boolean(item.fonte_id)}
                                                    compact
                                                />
                                                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
                                                    <span style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px', fontWeight: 500 }}>{item.template_nome_snapshot || 'Desconhecido'}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Row 2: Caption Preview & Actions */}
                                        <div style={{ padding: '16px', background: '#fafafa', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            {item.caption && (
                                                <div style={{ fontSize: '13px', color: '#475569', maxHeight: '60px', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', lineHeight: 1.5 }}>
                                                    {item.caption}
                                                </div>
                                            )}

                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                {copiedHistoryItems[item.id] ? (
                                                    <button disabled style={{ flex: 1, padding: '10px', background: '#16a34a', border: '1px solid #16a34a', borderRadius: '8px', fontSize: '13px', fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', cursor: 'default' }}>
                                                        <CheckCircle2 size={16} /> Texto copiado
                                                    </button>
                                                ) : (
                                                    <button onClick={() => handleCopyHistory(item)} style={{ flex: 1, padding: '10px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', cursor: 'pointer' }}>
                                                        <Copy size={16} /> Textos
                                                    </button>
                                                )}
                                                <button 
                                                    onClick={() => handleHistoryDownload(item)}
                                                    disabled={!item.render_url}
                                                    style={{ 
                                                        flex: 1, 
                                                        padding: '10px', 
                                                        background: !item.render_url ? '#f1f5f9' : '#1e293b', 
                                                        border: !item.render_url ? '1px solid #e2e8f0' : '1px solid #1e293b', 
                                                        borderRadius: '8px', 
                                                        fontSize: '13px', 
                                                        fontWeight: 600, 
                                                        color: !item.render_url ? '#94a3b8' : '#fff', 
                                                        display: 'flex', 
                                                        alignItems: 'center', 
                                                        justifyContent: 'center', 
                                                        gap: '6px', 
                                                        cursor: !item.render_url ? 'not-allowed' : 'pointer' 
                                                    }}
                                                >
                                                    {item.render_url ? (
                                                        <><Download size={16} /> Cópia (Frame/Arte)</>
                                                    ) : (
                                                        item.status === 'pending_render' ? 'Gerando arte...' : 
                                                        item.status === 'pending_review' ? 'Aguardando Aprovação' : 
                                                        'Arte Indisponível'
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}

                            {historyItems.length > 0 && hasMoreHistory && (
                                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '10px', marginBottom: '10px' }}>
                                    <button
                                        onClick={handleLoadMore}
                                        disabled={isLoadingHistory}
                                        style={{
                                            padding: '10px 20px',
                                            background: '#f1f5f9',
                                            border: '1px solid #cbd5e1',
                                            borderRadius: '8px',
                                            fontSize: '13px',
                                            fontWeight: 600,
                                            color: '#475569',
                                            cursor: isLoadingHistory ? 'not-allowed' : 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            transition: 'all 0.2s'
                                        }}
                                        onMouseOver={e => { if (!isLoadingHistory) { e.target.style.background = '#e2e8f0'; e.target.style.color = '#0f172a'; } }}
                                        onMouseOut={e => { if (!isLoadingHistory) { e.target.style.background = '#f1f5f9'; e.target.style.color = '#475569'; } }}
                                    >
                                        {isLoadingHistory ? <><RefreshCcw size={16} className="spin" /> Carregando...</> : 'Carregar Mais'}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                </div>

                {/* Sticky Bottom Bar for Action - Removed as the button is now part of ArticleForm */}


                <style>{`
@keyframes spin {
                    to { transform: rotate(360deg); }
}
@keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
}
`}</style>
            </div>
        </div>,
        document.body
    );
}
