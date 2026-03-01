import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../services/supabase';
import { Brain, Image as ImageIcon, UploadCloud, Copy, Download, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

// Cliente Fixo por ora
const FIXED_CLIENT_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9';

export default function EmployeeMode({ isOpen, onClose }) {
    const { user } = useAuth();
    const [form, setForm] = useState({ titulo: '', conteudo: '', imagem_url: '', url_original: '' });
    const [selectedFile, setSelectedFile] = useState(null);
    const [isDragging, setIsDragging] = useState(false);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);
    const [successData, setSuccessData] = useState(null); // { render_url, caption, template_nome }
    const [copied, setCopied] = useState(false);

    if (!isOpen) return null;

    // Upload image to Supabase if file is selected
    const handleFileUpload = async (file) => {
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
                    throw new Error(`Esta matéria já foi gerada no sistema por outro usuário. Pautas duplicadas não são permitidas.`);
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
                empresa_id: FIXED_CLIENT_ID,
                titulo: finalTitulo,
                conteudo: finalConteudo,
                url_original: form.url_original || null,
                imagem_url: finalImageUrl,
                auth_user_id: user?.id
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

            setSuccessData(data);
        } catch (err) {
            setErrorMsg(err.message || 'Erro ao gerar matéria. Verifique os templates ativos.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleCopy = () => {
        if (!successData?.caption) return;
        navigator.clipboard.writeText(successData.caption);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = async () => {
        if (!successData?.render_url) return;
        try {
            const response = await fetch(successData.render_url);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `materia_${Date.now()}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Erro ao baixar:", e);
            // Fallback: abrir em nova guia
            window.open(successData.render_url, '_blank');
        }
    };

    return createPortal(
        <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 9999, padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', width: '100vw', height: '100vh', position: 'fixed', top: 0, left: 0 }}>
            <div className="ap-modal-content" onClick={e => e.stopPropagation()} style={{ background: '#ffffff', padding: '0', borderRadius: '20px', width: '100%', maxWidth: '560px', maxHeight: '100%', boxShadow: '0 24px 48px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', flexShrink: 0 }}>
                    <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111827', margin: 0, display: 'flex', alignItems: 'center', gap: '10px', letterSpacing: '-0.02em' }}>
                        <div style={{ background: '#eff6ff', color: '#3b82f6', padding: '8px', borderRadius: '10px', display: 'flex' }}><Brain size={18} /></div>
                        Gerador de Pautas
                    </h2>
                    <button onClick={onClose} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', color: '#6b7280', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                        <X size={18} />
                    </button>
                </div>

                {/* Scrollable Content */}
                <div style={{ display: 'flex', flexDirection: 'column', padding: '20px', gap: '20px', overflowY: 'auto', flex: 1, WebkitOverflowScrolling: 'touch', width: '100%', boxSizing: 'border-box' }}>

                    {errorMsg && (
                        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '16px', borderRadius: '12px', marginBottom: '20px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                            <AlertCircle color="#ef4444" size={20} style={{ flexShrink: 0 }} />
                            <span style={{ color: '#991b1b', fontSize: '14px', fontWeight: 500 }}>{errorMsg}</span>
                        </div>
                    )}

                    {successData ? (
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

                            {/* Action Buttons */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
                                <button onClick={handleDownload} style={{ width: '100%', background: '#111827', color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', boxShadow: '0 4px 6px -1px rgba(17, 24, 39, 0.1)', cursor: 'pointer', transition: 'all 0.2s' }}>
                                    <Download size={18} /> Baixar Arte
                                </button>
                                <button onClick={handleCopy} style={{ width: '100%', background: '#fff', color: '#111827', border: '1px solid #e2e8f0', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: 'pointer', transition: 'all 0.2s' }}>
                                    {copied ? <><CheckCircle2 size={18} color="#10b981" /> Copiado!</> : <><Copy size={18} /> Copiar Legenda</>}
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
                                    onFocus={e => e.target.style.borderColor = '#3b82f6'}
                                    onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                                />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                                <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Texto Base (Manual)</label>
                                <textarea
                                    value={form.conteudo}
                                    onChange={e => setForm({ ...form, conteudo: e.target.value })}
                                    placeholder="Descreva os detalhes da notícia para a IA interpretar..."
                                    rows={4}
                                    style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', appearance: 'none', resize: 'vertical', boxSizing: 'border-box' }}
                                    onFocus={e => e.target.style.borderColor = '#3b82f6'}
                                    onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                                />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Foto Visual (Opcional)</label>
                                <div
                                    onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                                    onDragLeave={() => setIsDragging(false)}
                                    onDrop={e => {
                                        e.preventDefault();
                                        setIsDragging(false);
                                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                                            setSelectedFile(e.dataTransfer.files[0]);
                                        }
                                    }}
                                    onClick={() => document.getElementById('employee-file-upload').click()}
                                    style={{ border: isDragging ? '2px dashed #3b82f6' : '2px dashed #cbd5e1', borderRadius: '12px', padding: '30px 20px', textAlign: 'center', background: isDragging ? '#eff6ff' : '#ffffff', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '100%', boxSizing: 'border-box' }}
                                >
                                    <input
                                        id="employee-file-upload"
                                        type="file"
                                        accept="image/*"
                                        style={{ display: 'none' }}
                                        onChange={e => {
                                            if (e.target.files && e.target.files[0]) {
                                                setSelectedFile(e.target.files[0]);
                                            }
                                        }}
                                    />
                                    {selectedFile ? (
                                        <>
                                            <div style={{ background: '#dcfce7', color: '#16a34a', padding: '12px', borderRadius: '50%' }}>
                                                <ImageIcon size={28} />
                                            </div>
                                            <span style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>Foto Pronta!</span>
                                            <span style={{ fontSize: '13px', color: '#64748b' }}>{selectedFile.name}</span>
                                        </>
                                    ) : (
                                        <>
                                            <div style={{ background: '#f1f5f9', color: '#64748b', padding: '12px', borderRadius: '50%' }}>
                                                <UploadCloud size={28} />
                                            </div>
                                            <span style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>Tocar para adicionar foto externa</span>
                                            <span style={{ fontSize: '13px', color: '#64748b' }}>A IA usará a foto da matéria caso não tenha foto.</span>
                                        </>
                                    )}
                                </div>
                            </div>


                        </form>
                    )}
                </div>

                {/* Sticky Bottom Bar for Action */}
                {!successData && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '20px', borderTop: '1px solid #f0f0f0', background: '#ffffff', width: '100%', boxSizing: 'border-box' }}>
                        <button type="submit" onClick={handleGenerate} disabled={isSubmitting} style={{ width: '100%', boxSizing: 'border-box', background: isSubmitting ? '#475569' : '#111827', color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', boxShadow: '0 4px 6px -1px rgba(17, 24, 39, 0.1)', cursor: isSubmitting ? 'not-allowed' : 'pointer', transition: 'all 0.2s' }}>
                            {isSubmitting ? (
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
