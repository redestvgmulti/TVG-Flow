import React, { useState, useRef } from 'react';
import { supabase } from '../../services/supabase';
import { Brain, Image as ImageIcon, UploadCloud, Copy, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

// Cliente Fixo por ora
const FIXED_CLIENT_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9';

export default function EmployeeMode() {
    const { user } = useAuth();
    const [form, setForm] = useState({ titulo: '', conteudo: '', imagem_url: '' });
    const [selectedFile, setSelectedFile] = useState(null);
    const [isDragging, setIsDragging] = useState(false);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);
    const [successData, setSuccessData] = useState(null); // { render_url, caption, template_nome }
    const [copied, setCopied] = useState(false);

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
        if (!form.titulo && !form.conteudo) {
            setErrorMsg("Preencha o Título ou Conteúdo.");
            return;
        }

        setIsSubmitting(true);
        setErrorMsg(null);
        setSuccessData(null);

        try {
            let finalImageUrl = form.imagem_url;

            if (selectedFile) {
                finalImageUrl = await handleFileUpload(selectedFile);
            }

            const payload = {
                empresa_id: FIXED_CLIENT_ID,
                titulo: form.titulo,
                conteudo: form.conteudo,
                imagem_url: finalImageUrl,
                auth_user_id: user?.id
            };

            const { data, error } = await supabase.functions.invoke('ap-employee-generator', {
                body: payload
            });

            if (error) throw new Error(error.message || 'Erro de rede na Edge Function');
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

    return (
        <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
            {/* Cabecalho Mobile Simple */}
            <div style={{ background: '#ffffff', padding: '20px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'sticky', top: 0, zIndex: 10 }}>
                <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Brain size={20} color="#3b82f6" />
                    Gerador de Pautas
                </h1>
            </div>

            <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', paddingBottom: '100px' }}>

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
                            <button onClick={handleDownload} style={{ background: '#0f172a', color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', fontSize: '16px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
                                <Download size={20} /> Baixar Arte
                            </button>
                            <button onClick={handleCopy} style={{ background: '#fff', color: '#0f172a', border: '1px solid #cbd5e1', padding: '16px', borderRadius: '12px', fontSize: '16px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px' }}>
                                {copied ? <><CheckCircle2 size={20} color="#16a34a" /> Copiado!</> : <><Copy size={20} /> Copiar Legenda</>}
                            </button>
                            <button onClick={() => { setSuccessData(null); setForm({ titulo: '', conteudo: '', imagem_url: '' }); setSelectedFile(null); }} style={{ background: 'transparent', color: '#64748b', border: 'none', padding: '16px', fontSize: '15px', fontWeight: 500, marginTop: '10px' }}>
                                Criar Nova Matéria
                            </button>
                        </div>

                    </div>
                ) : (
                    <form onSubmit={handleGenerate} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Título Principal</label>
                            <input
                                value={form.titulo}
                                onChange={e => setForm({ ...form, titulo: e.target.value })}
                                placeholder="Grave acidente no centro..."
                                style={{ width: '100%', padding: '16px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '16px', outline: 'none', backgroundColor: '#fff', appearance: 'none' }}
                                onFocus={e => e.target.style.borderColor = '#3b82f6'}
                                onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                            />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Texto Base / Detalhes</label>
                            <textarea
                                value={form.conteudo}
                                onChange={e => setForm({ ...form, conteudo: e.target.value })}
                                placeholder="Descreva os detalhes da notícia para a IA interpretar..."
                                rows={5}
                                style={{ width: '100%', padding: '16px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '16px', outline: 'none', backgroundColor: '#fff', appearance: 'none', resize: 'vertical' }}
                                onFocus={e => e.target.style.borderColor = '#3b82f6'}
                                onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                            />
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Foto Visual (Obrigatório)</label>
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
                                style={{ border: isDragging ? '2px dashed #3b82f6' : '2px dashed #cbd5e1', borderRadius: '12px', padding: '30px 20px', textAlign: 'center', background: isDragging ? '#eff6ff' : '#ffffff', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}
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
                                        <span style={{ fontSize: '15px', fontWeight: 600, color: '#0f172a' }}>Tocar para adicionar foto</span>
                                        <span style={{ fontSize: '13px', color: '#64748b' }}>Foto limpa do evento (JPG/PNG)</span>
                                    </>
                                )}
                            </div>

                            <div style={{ textAlign: 'center', margin: '8px 0' }}>
                                <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 500, textTransform: 'uppercase' }}>OU URL DIRETA EXTERNA</span>
                            </div>

                            <input
                                value={form.imagem_url}
                                onChange={e => setForm({ ...form, imagem_url: e.target.value })}
                                placeholder="http://exemplo.com/foto.jpg"
                                style={{ width: '100%', padding: '16px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', appearance: 'none' }}
                                onFocus={e => e.target.style.borderColor = '#3b82f6'}
                                onBlur={e => e.target.style.borderColor = '#cbd5e1'}
                            />
                        </div>

                        {/* Sticky Bottom Bar for Action */}
                        <div style={{ position: 'fixed', bottom: 0, left: 0, width: '100%', background: '#ffffff', borderTop: '1px solid #e2e8f0', padding: '16px 20px', boxShadow: '0 -4px 6px -1px rgba(0,0,0,0.05)', zIndex: 20 }}>
                            <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                                <button type="submit" disabled={isSubmitting} style={{ width: '100%', background: isSubmitting ? '#475569' : '#0f172a', color: '#fff', border: 'none', padding: '18px', borderRadius: '12px', fontSize: '17px', fontWeight: 700, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', cursor: isSubmitting ? 'not-allowed' : 'pointer' }}>
                                    {isSubmitting ? (
                                        <>
                                            <div style={{ width: '20px', height: '20px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                                            Gerando (Pode levar 10s)...
                                        </>
                                    ) : (
                                        <><Brain size={22} /> Gerar Matéria</>
                                    )}
                                </button>
                            </div>
                        </div>

                    </form>
                )}
            </div>
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
    );
}
