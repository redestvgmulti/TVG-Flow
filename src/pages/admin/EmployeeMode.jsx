import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../services/supabase';
import { CheckCircle2, Copy, Download, X, AlertCircle, RefreshCcw, ImageIcon, Brain, Search, SearchCode, Video, Image as ImageIconLucide } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

// Fallback provider client
const FALLBACK_CLIENT_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9';

export default function EmployeeMode({ isOpen, onClose, user: propUser, empresaId }) {
    const { user: ctxUser, professionalId, role } = useAuth();
    const user = propUser || ctxUser;

    const [selectedFlow, setSelectedFlow] = useState(1); // 1 | 2 | 3
    const [form, setForm] = useState({
        url_original: '',
        tag: '',
        headline: '',
        texto: '',
        imagem_url: '',
        template_set: 'default',
        placid_template_uuid: null,
    });



    const [contentType, setContentType] = useState('feed'); // 'feed' | 'reels'

    const [availableTemplates, setAvailableTemplates] = useState([]);

    useEffect(() => {
        if (!clienteId) return;
        async function fetchTemplates() {
            try {
                const { data } = await supabase.schema('ap').from('templates').select('*').eq('cliente_id', clienteId).eq('ativo', true);
                if (data) setAvailableTemplates(data);
            } catch (err) { console.error("[EmployeeMode] Error fetching templates:", err); }
        }
        fetchTemplates();
    }, [clienteId]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [successData, setSuccessData] = useState(null);
    const [renderUrl, setRenderUrl] = useState(null); // Polled render result
    const [isPollingRender, setIsPollingRender] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [copied, setCopied] = useState(false);
    // Publication tracking per generated article
    const [actionBaixou, setActionBaixou] = useState(false);
    const [actionCopiou, setActionCopiou] = useState(false);
    const [isPublished, setIsPublished] = useState(false);

    // Multi-tenant resolution
    const [clienteId, setClienteId] = useState(empresaId || FALLBACK_CLIENT_ID);

    useEffect(() => {
        if (isOpen && professionalId && !empresaId) {
            // Use server-side RPC to bypass RLS restrictions safely
            supabase.rpc('get_my_cliente_id').then(({ data: id, error }) => {
                if (error) {
                    console.error('[EmployeeMode] Failed to resolve clienteId via RPC:', error);
                } else if (id) {
                    setClienteId(id);
                }
            });
        }
    }, [isOpen, professionalId, empresaId]);

    // Poll for render_url after employee submits — render runs async in background
    useEffect(() => {
        if (!isPollingRender || !successData?.news_id) return;

        let attempts = 0;
        const MAX_ATTEMPTS = 20; // ~60 seconds

        const interval = setInterval(async () => {
            attempts++;
            try {
                const { data } = await supabase
                    .from('ap_candidate_news_complete')
                    .select('render_url, status')
                    .eq('id', successData.news_id)
                    .maybeSingle();

                if (data?.render_url) {
                    setRenderUrl(data.render_url);
                    setIsPollingRender(false);
                    clearInterval(interval);
                } else if (attempts >= MAX_ATTEMPTS || data?.status === 'failed') {
                    setIsPollingRender(false);
                    clearInterval(interval);
                }
            } catch (e) {
                console.error('[EmployeeMode] Polling error:', e);
            }
        }, 3000);

        return () => clearInterval(interval);
    }, [isPollingRender, successData?.news_id]);

    // Tab state: 'create' | 'history'
    const [activeTab, setActiveTab] = useState('create');

    // History state
    const [historyItems, setHistoryItems] = useState([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [historyPage, setHistoryPage] = useState(0);
    const [hasMoreHistory, setHasMoreHistory] = useState(true);
    const [copiedHistoryItems, setCopiedHistoryItems] = useState({});
    const ITEMS_PER_PAGE = 20;

    const handleCopyHistory = (item) => {
        if (!item.caption) return;
        navigator.clipboard.writeText(item.caption);
        setCopiedHistoryItems(prev => ({ ...prev, [item.id]: true }));
        setTimeout(() => {
            setCopiedHistoryItems(prev => ({ ...prev, [item.id]: false }));
        }, 2000);
    };

    // File Upload State
    const [selectedFile, setSelectedFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

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
        e.preventDefault();
        const { url_original, tag, headline, texto, imagem_url } = form;

        // Per-flow validation
        if (!tag) { setErrorMsg('Tag de editoria é obrigatória.'); return; }
        if (form.template_set === 'individuais' && !form.placid_template_uuid) { setErrorMsg('Selecione um template para a campanha individual.'); return; }
        if (selectedFlow === 1 && !url_original) { setErrorMsg('Link é obrigatório no Fluxo 1.'); return; }
        if (selectedFlow === 2 && (!url_original || !headline)) { setErrorMsg('Link e Headline obrigatórios no Fluxo 2.'); return; }
        if (selectedFlow === 3 && (!headline || !texto)) { setErrorMsg('Headline e Texto obrigatórios no Fluxo 3.'); return; }
        if (selectedFlow === 3 && !url_original && !imagem_url && !selectedFile && contentType === 'feed') {
            setErrorMsg('Imagem obrigatória para matérias manuais sem link (Fluxo 3).');
            return;
        }

        setIsSubmitting(true);
        setErrorMsg(null);
        setSuccessData(null);

        try {
            if (url_original) {
                // Check for duplicates
                const { data: existingNews, error: searchError } = await supabase
                    .from('ap_candidate_news')
                    .select('id')
                    .eq('url_original', url_original)
                    .eq('cliente_id', clienteId)
                    .limit(1);

                if (!searchError && existingNews && existingNews.length > 0) {
                    throw new Error(`Esta matéria já foi gerada no sistema por outro usuário. Pautas duplicadas não são permitidas.`);
                }
            } else if (headline) {
                const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                const { data: existingNews, error: searchError } = await supabase
                    .from('ap_candidate_news')
                    .select('id')
                    .eq('cliente_id', clienteId)
                    .ilike('headline', headline)
                    .gte('created_at', twentyFourHoursAgo)
                    .limit(1);

                if (!searchError && existingNews && existingNews.length > 0) {
                    throw new Error('Uma matéria com este headline já foi gerada nas últimas 24h para sua conta.');
                }
            }

            let scrapedTitle = '';
            let scrapedConteudo = '';
            let scrapedImage = '';

            // Auto-Scraping Logic (Fluxo 1 e 2)
            if (url_original && selectedFlow !== 3) {
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

            let finalImageUrl = imagem_url || scrapedImage || null;
            if (selectedFile && contentType === 'feed') {
                finalImageUrl = await handleFileUpload(selectedFile);
            }

            const payload = {
                empresa_id: clienteId,
                titulo: headline || scrapedTitle || 'Pauta OMNI',
                conteudo: texto || scrapedConteudo || '',
                url_original: url_original || null,
                imagem_url: contentType === 'feed' ? finalImageUrl : null,
                content_type: contentType,
                auth_user_id: professionalId || user?.id,
                // Hybrid fields
                userTag: tag.toUpperCase(),
                userHeadline: selectedFlow >= 2 ? (headline || null) : null,
                userText: texto ? texto : null, // Fix 1: send userText whenever texto exists
                template_set: form.template_set || 'default',
                placid_template_uuid: form.placid_template_uuid || null,
            };

            const { data, error } = await supabase.functions.invoke('ap-employee-generator', {
                body: payload
            });

            if (error) {
                let realErrorMsg = error.message;
                if (error.context) {
                    try {
                        const errBody = await error.context.json();
                        if (errBody && errBody.error) realErrorMsg = errBody.error;
                    } catch (e) {
                        console.error('Failed to parse edge function error:', e);
                    }
                }
                throw new Error(realErrorMsg || 'Erro de rede na Edge Function');
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

            if (parsedData?.error) throw new Error(parsedData.error);

            setSuccessData(parsedData);
            setRenderUrl(null);
            setActionBaixou(false);
            setActionCopiou(false);
            setIsPublished(false);

            // If render is pending (employee flow), start polling
            if (parsedData?.render_pending && parsedData?.news_id) {
                setIsPollingRender(true);
            }
        } catch (err) {
            setErrorMsg(err.message || 'Erro ao gerar matéria. Verifique os templates ativos.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const markActionInDB = async (newsId, field) => {
        if (!newsId) return;
        // Update the action flag
        const update = { [field]: true };
        // Check if other flag is already set
        const otherField = field === 'acao_baixou' ? 'acao_copiou' : 'acao_baixou';
        const otherVal = field === 'acao_baixou' ? actionCopiou : actionBaixou;
        // If other flag is ALREADY true, promote to published
        if (otherVal) {
            update.status = 'published';
        }
        await supabase.schema('ap').from('candidate_news')
            .update(update)
            .eq('id', newsId);
    };

    const handleCopy = async () => {
        if (!successData?.caption) return;

        let copyText = successData.caption;
        // Removido a concatenação forçada de Roteiro + Legenda para Reels, para manter a legenda "clean" como solicitado.
        // O roteiro continua sendo exibido no modal para consulta se for Reels.

        navigator.clipboard.writeText(copyText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        const newCopiou = true;
        setActionCopiou(newCopiou);
        if (successData?.news_id) {
            await markActionInDB(successData.news_id, 'acao_copiou');
            if (actionBaixou) setIsPublished(true);
        }
    };

    const handleDownloadUrl = async (url, type = 'feed') => {
        if (!url) return;

        // Evita erro de CORS (net::ERR_FAILED) no fetch e avisos do SW no console
        if (url.includes('/storage/v1/object/')) {
            const separator = url.includes('?') ? '&' : '?';
            const downloadUrl = `${url}${separator}download=`;
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = '';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            return;
        }

        try {
            const response = await fetch(url);
            const blob = await response.blob();
            let ext = '.bin';
            if (blob.type === 'image/jpeg') ext = '.jpg';
            else if (blob.type === 'image/png') ext = '.png';
            else if (blob.type === 'video/mp4') ext = '.mp4';
            else if (blob.type === 'image/webp') ext = '.webp';
            else {
                const match = url.match(/\.([a-z0-9]+)(?:[\?#]|$)/i);
                if (match) ext = `.${match[1].toLowerCase()}`;
            }

            const objUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objUrl;
            link.download = type === 'reels' ? `frame_${Date.now()}${ext}` : `materia_${Date.now()}${ext}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(objUrl);
        } catch (e) {
            console.error("Erro ao baixar:", e);
            window.open(url, '_blank');
        }
    };

    const handleDownload = async () => {
        const url = renderUrl || successData?.render_url;
        await handleDownloadUrl(url, successData?.content_type);
        const newBaixou = true;
        setActionBaixou(newBaixou);
        if (successData?.news_id) {
            await markActionInDB(successData.news_id, 'acao_baixou');
            if (actionCopiou) setIsPublished(true);
        }
    };

    const fetchHistory = async (page = 0, append = false) => {
        setIsLoadingHistory(true);
        try {
            const { data, error } = await supabase
                .from('ap_candidate_news_complete')
                .select('id, titulo, headline, caption, render_url, gerado_em, status, template_nome_snapshot, context_tag')
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
        setHistoryPage(0);
        fetchHistory(0, false);
    }, [isOpen, activeTab, user]);

    const handleLoadMore = () => {
        const nextPage = historyPage + 1;
        setHistoryPage(nextPage);
        fetchHistory(nextPage, true);
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 9999, padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', width: '100vw', height: '100vh', position: 'fixed', top: 0, left: 0 }}>
            <div className="ap-modal-content" onClick={e => e.stopPropagation()} style={{ background: '#ffffff', padding: '0', borderRadius: '20px', width: '100%', maxWidth: '560px', maxHeight: '100%', boxShadow: '0 24px 48px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', flexShrink: 0 }}>
                    <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111827', margin: 0, display: 'flex', alignItems: 'center', gap: '10px', letterSpacing: '-0.02em' }}>
                        <div style={{ background: '#eff6ff', color: '#3b82f6', padding: '8px', borderRadius: '10px', display: 'flex' }}><Brain size={18} /></div>
                        Nova Matéria
                    </h2>
                    <button onClick={onClose} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', color: '#6b7280', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                        <X size={18} />
                    </button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#fff', padding: '0 20px' }}>
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
                </div>

                {/* Scrollable Content */}
                <div style={{ display: 'flex', flexDirection: 'column', padding: '20px', gap: '20px', overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch', width: '100%', boxSizing: 'border-box' }}>

                    {errorMsg && (
                        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '16px', borderRadius: '12px', marginBottom: '10px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                            <AlertCircle color="#ef4444" size={20} style={{ flexShrink: 0 }} />
                            <span style={{ color: '#991b1b', fontSize: '14px', fontWeight: 500 }}>{errorMsg}</span>
                        </div>
                    )}

                    {activeTab === 'create' && (
                        successData ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', animation: 'fadeIn 0.5s ease-out' }}>

                                <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', padding: '16px', borderRadius: '12px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                                    <CheckCircle2 color="#16a34a" size={24} />
                                    <div>
                                        <h3 style={{ margin: 0, fontSize: '15px', color: '#166534', fontWeight: 700 }}>Material Pronto! ({successData.content_type === 'reels' ? 'Reels' : 'Feed'})</h3>
                                        <span style={{ fontSize: '13px', color: '#15803d' }}>Template usado: {successData.template_nome}</span>
                                    </div>
                                </div>

                                {/* Render Zone — shows spinner while polling, card when ready */}
                                {renderUrl ? (
                                    <div style={{ width: '100%', borderRadius: '16px', overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', animation: 'fadeIn 0.5s ease-out' }}>
                                        <img src={renderUrl} alt="Arte Final" style={{ width: '100%', display: 'block', objectFit: 'cover' }} />
                                    </div>
                                ) : isPollingRender ? (
                                    <div style={{ width: '100%', borderRadius: '16px', border: '1px dashed #bae6fd', background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)', padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', boxSizing: 'border-box' }}>
                                        <div style={{ width: 48, height: 48, background: '#3b82f6', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'spin 1.5s linear infinite' }}>
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
                                        </div>
                                        <p style={{ margin: 0, fontSize: '14px', color: '#0284c7', fontWeight: 700, textAlign: 'center' }}>Gerando arte...</p>
                                        <p style={{ margin: 0, fontSize: '12px', color: '#38bdf8', textAlign: 'center' }}>O Placid está renderizando seu card. Aguarde alguns segundos.</p>
                                    </div>
                                ) : (
                                    <div style={{ width: '100%', borderRadius: '16px', border: '1px dashed #e2e8f0', background: '#f8fafc', padding: '28px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', boxSizing: 'border-box' }}>
                                        <div style={{ width: 48, height: 48, background: '#fee2e2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                                        </div>
                                        <p style={{ margin: 0, fontSize: '14px', color: '#475569', fontWeight: 600, textAlign: 'center' }}>Arte não disponível.</p>
                                        <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', textAlign: 'center' }}>O render pode ter falhado. Tente novamente ou contate o administrador.</p>
                                    </div>
                                )}

                                {/* Content Results */}
                                {successData.content_type === 'reels' && successData.roteiro && (
                                    <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '16px', border: '1px dashed #cbd5e1', position: 'relative' }}>
                                        <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Roteiro Sugerido</h4>
                                        <p style={{ margin: 0, fontSize: '15px', color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                                            {successData.roteiro}
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
                                        Publicada! Esta matéria foi movida para o painel do Admin.
                                    </div>
                                )}

                                {/* Action Buttons */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
                                    <button onClick={handleDownload} disabled={isPollingRender && !renderUrl} style={{ width: '100%', background: actionBaixou ? '#16a34a' : (isPollingRender && !renderUrl) ? '#94a3b8' : '#111827', color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', boxShadow: '0 4px 6px -1px rgba(17, 24, 39, 0.1)', cursor: (isPollingRender && !renderUrl) ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}>
                                        {actionBaixou ? <CheckCircle2 size={18} /> : <Download size={18} />} {actionBaixou ? 'Frame/Resumo Baixado!' : (isPollingRender && !renderUrl) ? 'Aguardando arte...' : 'Baixar Imagem/Moldura'}
                                    </button>
                                    <button onClick={handleCopy} style={{ width: '100%', background: '#fff', color: actionCopiou ? '#16a34a' : '#111827', border: actionCopiou ? '2px solid #16a34a' : '1px solid #e2e8f0', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer', transition: 'all 0.2s' }}>
                                        {actionCopiou ? <><CheckCircle2 size={18} color="#16a34a" /> Copiado!</> : <><Copy size={18} /> Copiar {successData.content_type === 'reels' ? 'Roteiro e Legenda' : 'Legenda'}</>}
                                    </button>
                                    <button onClick={() => { setSuccessData(null); setForm({ url_original: '', tag: '', headline: '', texto: '', imagem_url: '' }); setSelectedFile(null); }} style={{ background: 'transparent', color: '#64748b', border: 'none', padding: '16px', fontSize: '14px', fontWeight: 600, marginTop: '4px', cursor: 'pointer' }}>

                                        Novo Conteúdo
                                    </button>
                                </div>

                            </div>
                        ) : (
                            <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                                <div style={{ display: 'flex', gap: '8px', background: '#f1f5f9', padding: '6px', borderRadius: '16px', overflowX: 'auto', marginBottom: '16px' }}>
                                    {[
                                        { id: 1, label: 'Link + Tag' },
                                        { id: 2, label: 'Link + Tag + Headline' },
                                        { id: 3, label: 'Manual' }
                                    ].map(flow => (
                                        <button
                                            key={flow.id}
                                            type="button"
                                            onClick={() => setSelectedFlow(flow.id)}
                                            style={{
                                                flex: 1, padding: '10px 8px', borderRadius: '12px', border: 'none',
                                                background: selectedFlow === flow.id ? '#fff' : 'transparent',
                                                color: selectedFlow === flow.id ? '#0f172a' : '#64748b',
                                                fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap',
                                                boxShadow: selectedFlow === flow.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                                                cursor: 'pointer', transition: 'all 0.2s'
                                            }}
                                        >
                                            {flow.label}
                                        </button>
                                    ))}
                                </div>

                                {/* Formato Selector */}
                                <div style={{ display: 'flex', gap: '12px', background: '#f1f5f9', padding: '6px', borderRadius: '16px' }}>
                                    <button
                                        type="button"
                                        onClick={() => setContentType('feed')}
                                        style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: contentType === 'feed' ? '#fff' : 'transparent', color: contentType === 'feed' ? '#0f172a' : '#64748b', fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: contentType === 'feed' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', cursor: 'pointer', transition: 'all 0.2s' }}
                                    >
                                        <ImageIconLucide size={18} /> Estático (Feed)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setContentType('reels')}
                                        style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: contentType === 'reels' ? '#fff' : 'transparent', color: contentType === 'reels' ? '#0f172a' : '#64748b', fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', boxShadow: contentType === 'reels' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', cursor: 'pointer', transition: 'all 0.2s' }}
                                    >
                                        <Video size={18} /> Vídeo (Reels)
                                    </button>
                                </div>

                                {/* Part 4 - Template Selector */}
                                <div style={{ display: 'flex', gap: '16px', background: '#f8fafc', padding: '16px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Campanha Visual</label>
                                        <select
                                            value={form.template_set}
                                            onChange={e => setForm({ ...form, template_set: e.target.value, placid_template_uuid: null })}
                                            style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none', backgroundColor: '#fff', cursor: 'pointer' }}
                                        >
                                            <option value="default">Padrão OMNI (Automático)</option>
                                            <option value="individuais">Templates Manuais</option>
                                        </select>
                                    </div>
                                    {form.template_set === 'individuais' && (
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', animation: 'fadeIn 0.2s ease-out' }}>
                                            <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Selecionar Template</label>
                                            <select
                                                value={form.placid_template_uuid || ''}
                                                onChange={e => setForm({ ...form, placid_template_uuid: e.target.value })}
                                                style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none', backgroundColor: '#fff', cursor: 'pointer' }}
                                            >
                                                <option value="" disabled>Escolha um template...</option>
                                                {availableTemplates.filter(t => t.formato === contentType).map(t => (
                                                    <option key={t.id} value={t.placid_template_uuid}>{t.nome}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>

                                {/* Tag Obrigatória */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Editoria (Tag) <span style={{ color: '#ef4444' }}>*</span></label>
                                    <input
                                        value={form.tag}
                                        onChange={e => setForm({ ...form, tag: e.target.value.toUpperCase() })}
                                        placeholder="Ex: URGENTE"
                                        style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }}
                                    />
                                </div>

                                {/* Link */}
                                {(selectedFlow === 1 || selectedFlow === 2) && (
                                    <div style={{ padding: '16px', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px', width: '100%', boxSizing: 'border-box' }}>
                                        <label style={{ fontSize: '14px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Link Origem <span style={{ color: '#ef4444' }}>*</span></label>
                                        <p style={{ margin: 0, fontSize: '13px', color: '#0369a1' }}>A IA irá extrair o conteúdo desta URL.</p>
                                        <input
                                            value={form.url_original || ''}
                                            onChange={e => setForm({ ...form, url_original: e.target.value })}
                                            placeholder="https://globo.com/noticia..."
                                            style={{ width: '100%', padding: '14px', borderRadius: '10px', border: '1px solid #7dd3fc', fontSize: '15px', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }}
                                        />
                                    </div>
                                )}

                                {/* Headline (Opcional/Obrigatório) */}
                                {(selectedFlow === 2 || selectedFlow === 3) && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                                        <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
                                            Headline Maior <span style={{ color: '#ef4444' }}>*</span>
                                        </label>
                                        <input
                                            value={form.headline}
                                            onChange={e => setForm({ ...form, headline: e.target.value })}
                                            placeholder="Ex: Novo viaduto é inaugurado..."
                                            style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }}
                                        />
                                    </div>
                                )}

                                {/* Texto Base */}
                                {selectedFlow === 3 && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                                        <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Texto Base da Matéria <span style={{ color: '#ef4444' }}>*</span></label>
                                        <textarea
                                            value={form.texto}
                                            onChange={e => setForm({ ...form, texto: e.target.value })}
                                            placeholder="Escreva a notícia base. A IA revisará e criará a caption com hashtags..."
                                            rows={4}
                                            style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', resize: 'vertical', minHeight: '80px', boxSizing: 'border-box' }}
                                        />
                                    </div>
                                )}

                                {contentType === 'feed' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                                        <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Foto (Fundo do Card)</label>

                                        <div
                                            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                                            onDragLeave={() => setIsDragging(false)}
                                            onDrop={e => {
                                                e.preventDefault();
                                                setIsDragging(false);
                                                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                                                    setSelectedFile(e.dataTransfer.files[0]);
                                                    setForm({ ...form, imagem_url: '' });
                                                }
                                            }}
                                            style={{
                                                border: isDragging ? '2px dashed #3b82f6' : '2px dashed #cbd5e1',
                                                borderRadius: '12px',
                                                padding: '20px 16px',
                                                textAlign: 'center',
                                                background: isDragging ? '#eff6ff' : '#f8fafc',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}
                                            onClick={() => document.getElementById('employee-file-input').click()}
                                        >
                                            <input
                                                id="employee-file-input"
                                                type="file"
                                                accept="image/*"
                                                style={{ display: 'none' }}
                                                onChange={(e) => {
                                                    if (e.target.files && e.target.files[0]) {
                                                        setSelectedFile(e.target.files[0]);
                                                        setForm({ ...form, imagem_url: '' });
                                                    }
                                                }}
                                            />

                                            {selectedFile ? (
                                                <>
                                                    <div style={{ background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        <CheckCircle2 size={16} /> Arquivo Anexado: {selectedFile.name}
                                                    </div>
                                                    <span style={{ fontSize: '12px', color: '#64748b' }}>Clique para alterar</span>
                                                </>
                                            ) : (
                                                <>
                                                    <div style={{ background: '#e2e8f0', width: '40px', height: '40px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <ImageIcon size={20} color="#64748b" />
                                                    </div>
                                                    <span style={{ fontSize: '14px', color: '#475569', fontWeight: 500 }}>
                                                        Clique ou arraste a imagem original aqui
                                                    </span>
                                                </>
                                            )}
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0' }}>
                                            <div style={{ height: '1px', background: '#cbd5e1', flex: 1 }}></div>
                                            <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>OU URL</span>
                                            <div style={{ height: '1px', background: '#cbd5e1', flex: 1 }}></div>
                                        </div>

                                        <input
                                            value={form.imagem_url}
                                            onChange={e => {
                                                setForm({ ...form, imagem_url: e.target.value });
                                                if (e.target.value) setSelectedFile(null);
                                            }}
                                            placeholder="https://exemplo.com/foto.jpg"
                                            style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', appearance: 'none', boxSizing: 'border-box' }}
                                            onFocus={e => e.target.style.borderColor = '#94a3b8'}
                                            onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                                        />
                                    </div>
                                )}


                            </form>
                        )
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
                                                <img src={item.render_url} alt="" style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #e2e8f0', cursor: 'pointer' }} onClick={() => window.open(item.render_url, '_blank')} />
                                            ) : (
                                                <div style={{ width: '80px', height: '80px', background: '#f1f5f9', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <ImageIcon size={24} color="#cbd5e1" />
                                                </div>
                                            )}

                                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                                <h4 style={{ margin: '0 0 4px 0', fontSize: '15px', color: '#1e293b', fontWeight: 600, lineHeight: 1.3 }}>{item.headline || item.titulo || 'Materia Sem Título'}</h4>
                                                <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                    <span>{item.gerado_em ? new Date(item.gerado_em).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : ''}</span>
                                                    •
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
                                                <button onClick={() => handleDownloadUrl(item.render_url)} style={{ flex: 1, padding: '10px', background: '#1e293b', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '13px', fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', cursor: 'pointer' }}>
                                                    <Download size={16} /> Cópia (Frame/Arte)
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

                {/* Sticky Bottom Bar for Action */}
                {activeTab === 'create' && !successData && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '20px', borderTop: '1px solid #f0f0f0', background: '#ffffff', width: '100%', boxSizing: 'border-box' }}>
                        <button type="submit" onClick={handleGenerate} disabled={isSubmitting || isUploading || (!form.tag || (selectedFlow === 1 && !form.url_original))} style={{ width: '100%', boxSizing: 'border-box', background: (isSubmitting || isUploading) ? '#cbd5e1' : '#2563eb', color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', boxShadow: (isSubmitting || isUploading) ? 'none' : '0 4px 6px -1px rgba(37, 99, 235, 0.2), 0 2px 4px -1px rgba(37, 99, 235, 0.1)', cursor: (isSubmitting || isUploading) ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}>
                            {isSubmitting || isUploading ? (
                                <>
                                    <div style={{ width: '18px', height: '18px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                                    Extraindo e Gerando IA...
                                </>
                            ) : (
                                <><Brain size={18} /> {contentType === 'reels' ? 'Gerar Roteiro e Frame' : 'Gerar Matéria'}</>
                            )}
                        </button>
                    </div>
                )}

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
