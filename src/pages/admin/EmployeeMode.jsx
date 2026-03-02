import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../services/supabase';
import { CheckCircle2, Copy, Download, X, AlertCircle, RefreshCcw, ImageIcon, Brain, Search, SearchCode } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { resolveClienteId } from '../../services/resolveClienteId';

// Fallback provider client
const FALLBACK_CLIENT_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9';

export default function EmployeeMode({ isOpen, onClose, user: propUser, empresaId }) {
    const { user: ctxUser, professionalId, role } = useAuth();
    const user = propUser || ctxUser;

    const [form, setForm] = useState({
        titulo: '',
        conteudo: '',
        imagem_url: '',
        url_original: ''
    });

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [successData, setSuccessData] = useState(null);
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

    // Tab state: 'create' | 'history'
    const [activeTab, setActiveTab] = useState('create');

    // History state
    const [historyItems, setHistoryItems] = useState([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [historyPage, setHistoryPage] = useState(0);
    const [hasMoreHistory, setHasMoreHistory] = useState(true);
    const ITEMS_PER_PAGE = 20;

    // File Upload State
    const [selectedFile, setSelectedFile] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    // Upload image to Supabase if file is selected
    const handleFileUpload = async (file) => {
        setIsUploading(true);
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${Math.random()}.${fileExt}`;
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
        if (!form.titulo && !form.conteudo && !form.url_original) {
            setErrorMsg("Preencha o Título, Conteúdo ou insira um Link Externo.");
            return;
        }

        setIsSubmitting(true);
        setErrorMsg(null);
        setSuccessData(null);

        try {
            let finalTitulo = form.titulo;
            let finalConteudo = form.conteudo;
            let finalImageUrl = form.imagem_url;

            if (form.url_original) {
                // Check for duplicates first using the complete view to get more details if needed
                const { data: existingNews, error: searchError } = await supabase
                    .from('ap_candidate_news')
                    .select('id')
                    .eq('url_original', form.url_original)
                    .limit(1);

                if (!searchError && existingNews && existingNews.length > 0) {
                    throw new Error(`Esta matéria já foi gerada no sistema por outro usuário.Pautas duplicadas não são permitidas.`);
                }
            }

            // Auto-Scraping Logic (If URL is provided but content is missing)
            if (form.url_original && (!finalTitulo || !finalConteudo)) {
                const { data, error } = await supabase.functions.invoke('ap-link-scraper', {
                    body: { url: form.url_original }
                });

                if (error) {
                    console.error('[EmployeeMode] Auto-Scrape error:', error);
                    throw new Error('A IA falhou ao extrair dados do link. Verifique se a URL é suportada ou preencha o texto manualmente.');
                }

                finalTitulo = data.title || finalTitulo;
                finalConteudo = data.content || finalConteudo;
                finalImageUrl = data.image_url || finalImageUrl;
            }

            if (!finalTitulo || !finalConteudo) {
                throw new Error('Não foi possível obter Título e Conteúdo. Preencha manualmente ou tente outro link.');
            }

            if (selectedFile) {
                finalImageUrl = await handleFileUpload(selectedFile);
            }

            const payload = {
                empresa_id: clienteId,
                titulo: finalTitulo,
                conteudo: finalConteudo,
                url_original: form.url_original || null,
                imagem_url: finalImageUrl,
                auth_user_id: professionalId || user?.id
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
            setActionBaixou(false);
            setActionCopiou(false);
            setIsPublished(false);
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
        navigator.clipboard.writeText(successData.caption);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        const newCopiou = true;
        setActionCopiou(newCopiou);
        if (successData?.news_id) {
            await markActionInDB(successData.news_id, 'acao_copiou');
            if (actionBaixou) setIsPublished(true);
        }
    };

    const handleDownloadUrl = async (url) => {
        if (!url) return;
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const objUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objUrl;
            link.download = `materia_${Date.now()}.png`;
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
        await handleDownloadUrl(successData?.render_url);
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
                        Painel de Pautas AI
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
                        Criar Matéria
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
                                        <h3 style={{ margin: 0, fontSize: '15px', color: '#166534', fontWeight: 700 }}>Material Pronto!</h3>
                                        <span style={{ fontSize: '13px', color: '#15803d' }}>Template usado: {successData.template_nome}</span>
                                    </div>
                                </div>

                                {/* Rendering Result */}
                                <div style={{ width: '100%', borderRadius: '16px', overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
                                    <img src={successData.render_url} alt="Arte Final" style={{ width: '100%', display: 'block', objectFit: 'cover' }} />
                                </div>

                                {/* Caption Result */}
                                <div style={{ background: '#fff', padding: '16px', borderRadius: '16px', border: '1px solid #e2e8f0', position: 'relative' }}>
                                    <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Legenda Sugerida</h4>
                                    <p style={{ margin: 0, fontSize: '15px', color: '#334155', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                                        {successData.caption}
                                    </p>
                                </div>

                                {/* Action Tracking Bar */}
                                {(actionBaixou || actionCopiou) && !isPublished && (
                                    <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: '10px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: '#92400e', fontWeight: 500 }}>
                                        <span>Falta {actionBaixou ? '✓ Arte' : '◦ Arte'} {actionCopiou ? '✓ Legenda' : '◦ Legenda'} para publicar</span>
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
                                    <button onClick={handleDownload} style={{ width: '100%', background: actionBaixou ? '#16a34a' : '#111827', color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', boxShadow: '0 4px 6px -1px rgba(17, 24, 39, 0.1)', cursor: 'pointer', transition: 'all 0.2s' }}>
                                        {actionBaixou ? <CheckCircle2 size={18} /> : <Download size={18} />} {actionBaixou ? 'Arte baixada!' : 'Baixar Arte'}
                                    </button>
                                    <button onClick={handleCopy} style={{ width: '100%', background: '#fff', color: actionCopiou ? '#16a34a' : '#111827', border: actionCopiou ? '2px solid #16a34a' : '1px solid #e2e8f0', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer', transition: 'all 0.2s' }}>
                                        {actionCopiou ? <><CheckCircle2 size={18} color="#16a34a" /> Legenda copiada!</> : <>{copied ? <><CheckCircle2 size={18} color="#10b981" /> Copiado!</> : <><Copy size={18} /> Copiar Legenda</>}</>}
                                    </button>
                                    <button onClick={() => { setSuccessData(null); setForm({ titulo: '', conteudo: '', imagem_url: '', url_original: '' }); setSelectedFile(null); }} style={{ background: 'transparent', color: '#64748b', border: 'none', padding: '16px', fontSize: '14px', fontWeight: 600, marginTop: '4px', cursor: 'pointer' }}>
                                        Criar Nova Matéria
                                    </button>
                                </div>

                            </div>
                        ) : (
                            <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                                <div style={{ padding: '16px', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px', width: '100%', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Motor de IA (Link)</label>
                                    <p style={{ margin: 0, fontSize: '13px', color: '#0369a1' }}>Cole um link para a IA extrair todo o contexto e foto automaticamente.</p>
                                    <input
                                        value={form.url_original || ''}
                                        onChange={e => setForm({ ...form, url_original: e.target.value })}
                                        placeholder="https://globo.com/acidente..."
                                        style={{ width: '100%', padding: '14px', borderRadius: '10px', border: '1px solid #7dd3fc', fontSize: '15px', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }}
                                        onFocus={e => e.target.style.borderColor = '#0284c7'}
                                        onBlur={e => e.target.style.borderColor = '#7dd3fc'}
                                    />
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', opacity: 0.6, marginTop: '-4px', marginBottom: '-4px' }}>
                                    <div style={{ height: '1px', background: '#cbd5e1', flex: 1 }}></div>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Ou faça manualmente</span>
                                    <div style={{ height: '1px', background: '#cbd5e1', flex: 1 }}></div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Título (Manual)</label>
                                    <input
                                        value={form.titulo}
                                        onChange={e => setForm({ ...form, titulo: e.target.value })}
                                        placeholder="Grave acidente no centro..."
                                        style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', appearance: 'none', boxSizing: 'border-box' }}
                                        onFocus={e => e.target.style.borderColor = '#94a3b8'}
                                        onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                                    />
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Detalhes Adicionais</label>
                                    <textarea
                                        value={form.conteudo}
                                        onChange={e => setForm({ ...form, conteudo: e.target.value })}
                                        placeholder="Mais informações se necessário..."
                                        rows={3}
                                        style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', resize: 'vertical', minHeight: '80px', appearance: 'none', boxSizing: 'border-box' }}
                                        onFocus={e => e.target.style.borderColor = '#94a3b8'}
                                        onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                                    />
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Foto de Capa</label>

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
                                                <button onClick={() => { navigator.clipboard.writeText(item.caption); alert("Legenda copiada!") }} style={{ flex: 1, padding: '10px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '13px', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', cursor: 'pointer' }}>
                                                    <Copy size={16} /> Legenda
                                                </button>
                                                <button onClick={() => handleDownloadUrl(item.render_url)} style={{ flex: 1, padding: '10px', background: '#1e293b', border: '1px solid #1e293b', borderRadius: '8px', fontSize: '13px', fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', cursor: 'pointer' }}>
                                                    <Download size={16} /> Arte
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
                        <button type="submit" onClick={handleGenerate} disabled={isSubmitting || isUploading || (!form.titulo && !form.url_original)} style={{ width: '100%', boxSizing: 'border-box', background: (isSubmitting || isUploading || (!form.titulo && !form.url_original)) ? '#cbd5e1' : '#2563eb', color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', boxShadow: (isSubmitting || isUploading || (!form.titulo && !form.url_original)) ? 'none' : '0 4px 6px -1px rgba(37, 99, 235, 0.2), 0 2px 4px -1px rgba(37, 99, 235, 0.1)', cursor: (isSubmitting || isUploading || (!form.titulo && !form.url_original)) ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}>
                            {isSubmitting || isUploading ? (
                                <>
                                    <div style={{ width: '18px', height: '18px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                                    Extraindo e Gerando IA...
                                </>
                            ) : (
                                <><Brain size={18} /> Gerar Matéria</>
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
