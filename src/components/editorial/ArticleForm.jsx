import React, { useState } from 'react';
import { ImageIcon, Video, UploadCloud, CheckCircle2 } from 'lucide-react';

export default function ArticleForm({
    mode = 'admin',
    formData,
    setFormData,
    errors = {},
    onSubmit,
    isSubmitting,
    onCancel,
    availableTemplates = [],
    selectedFile,
    setSelectedFile
}) {
    const [isDragging, setIsDragging] = useState(false);

    return (
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
            {/* Formato */}
            <div style={{ display: 'flex', gap: '8px', background: '#f1f5f9', padding: '6px', borderRadius: '16px', flexWrap: 'wrap' }}>
                {[
                    ['feed', 'Estático', <ImageIcon size={18} key="feed" />],
                    ['reels', 'Reels', <Video size={18} key="reels" />],
                    ['carousel', 'Carrossel', <Brain size={18} key="carousel" />],
                    ['sponsored', 'Patrocinado', <Zap size={18} key="sponsored" />]
                ].map(([val, lbl, icon]) => (
                    <button key={val} type="button" onClick={() => setFormData({ ...formData, content_type: val })}
                        style={{ flex: '1 1 120px', padding: '10px 8px', borderRadius: '12px', border: 'none', background: formData.content_type === val ? '#fff' : 'transparent', color: formData.content_type === val ? '#0f172a' : '#64748b', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', boxShadow: formData.content_type === val ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', cursor: 'pointer', transition: 'all 0.2s' }}>
                        {icon} <span style={{ whiteSpace: 'nowrap' }}>{lbl}</span>
                    </button>
                ))}
            </div>

            {/* Part 4 - Template Selector */}
            <div style={{ display: 'flex', gap: '16px', background: '#f8fafc', padding: '16px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Campanha Visual</label>
                    <select
                        value={formData.template_set || 'default'}
                        onChange={e => setFormData({ ...formData, template_set: e.target.value, placid_template_uuid: null })}
                        style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '14px', outline: 'none', backgroundColor: '#fff', cursor: 'pointer' }}
                    >
                        <option value="default">Padrão</option>
                        <option value="individuais">Individuais</option>
                        <option value="natal">Natal</option>
                        <option value="ano_novo">Ano Novo</option>
                        <option value="dia_das_mulheres">Dia das Mulheres</option>
                        <option value="dia_dos_pais">Dia dos Pais</option>
                    </select>
                </div>
                {formData.template_set && formData.template_set !== 'default' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', animation: 'fadeIn 0.2s ease-out' }}>
                        <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Selecionar Template</label>
                        <select
                            value={formData.placid_template_uuid || ''}
                            onChange={e => setFormData({ ...formData, placid_template_uuid: e.target.value })}
                            style={{ width: '100%', padding: '12px 14px', borderRadius: '10px', border: typeof errors.placid_template_uuid === 'string' ? '1px solid #ef4444' : '1px solid #cbd5e1', fontSize: '14px', outline: 'none', backgroundColor: '#fff', cursor: 'pointer' }}
                        >
                            <option value="" disabled>Escolha um template...</option>
                            {availableTemplates.map(t => (
                                <option key={t.id} value={t.placid_template_uuid}>{t.nome}</option>
                            ))}
                        </select>
                        {typeof errors.placid_template_uuid === 'string' && <span style={{ color: '#ef4444', fontSize: '12px', fontWeight: 600 }}>{errors.placid_template_uuid}</span>}
                    </div>
                )}
            </div>

            {/* Tag Obrigatória */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Editoria (Tag) <span style={{ color: '#ef4444' }}>*</span></label>
                <input
                    value={formData.context_tag || ''}
                    onChange={e => setFormData({ ...formData, context_tag: e.target.value.toUpperCase() })}
                    placeholder="Ex: URGENTE"
                    style={{ width: '100%', padding: '14px', borderRadius: '12px', border: typeof errors.context_tag === 'string' ? '1px solid #ef4444' : '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }}
                />
            </div>

            {/* Link Origem */}
            <div style={{ padding: '16px', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                <label style={{ fontSize: '14px', fontWeight: 700, color: '#0284c7', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Link Origem <span style={{ color: '#ef4444' }}>*</span></label>
                <p style={{ margin: 0, fontSize: '13px', color: '#0369a1' }}>A IA irá extrair o conteúdo desta URL.</p>
                <input
                    value={formData.url_original || ''}
                    onChange={e => setFormData({ ...formData, url_original: e.target.value })}
                    placeholder="https://globo.com/noticia..."
                    style={{ width: '100%', padding: '14px', borderRadius: '10px', border: typeof errors.url_original === 'string' ? '1px solid #ef4444' : '1px solid #7dd3fc', fontSize: '15px', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }}
                />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', opacity: 0.6 }}>
                <div style={{ height: '1px', background: '#cbd5e1', flex: 1 }}></div>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Ou complete manualmente</span>
                <div style={{ height: '1px', background: '#cbd5e1', flex: 1 }}></div>
            </div>

            {/* Headline */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>
                    Headline Maior <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                    value={formData.titulo || ''}
                    onChange={e => setFormData({ ...formData, titulo: e.target.value })}
                    placeholder="Ex: Novo viaduto é inaugurado..."
                    style={{ width: '100%', padding: '14px', borderRadius: '12px', border: typeof errors.titulo === 'string' ? '1px solid #ef4444' : '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', boxSizing: 'border-box' }}
                />
            </div>

            {/* Texto Base */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Texto Base da Matéria <span style={{ color: '#ef4444' }}>*</span></label>
                <textarea
                    value={formData.conteudo || ''}
                    onChange={e => setFormData({ ...formData, conteudo: e.target.value })}
                    placeholder="Escreva a notícia base. A IA revisará e criará a caption com hashtags..."
                    rows={4}
                    style={{ width: '100%', padding: '14px', borderRadius: '12px', border: typeof errors.conteudo === 'string' ? '1px solid #ef4444' : '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', resize: 'vertical', minHeight: '80px', boxSizing: 'border-box' }}
                />
            </div>

            {/* Foto (feed only) */}
            {formData.content_type === 'feed' && (
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
                                setFormData({ ...formData, image_url: '' });
                            }
                        }}
                        style={{
                            border: isDragging ? '2px dashed #3b82f6' : '2px dashed #cbd5e1',
                            borderRadius: '12px',
                            padding: '20px 16px',
                            textAlign: 'center',
                            background: isDragging ? '#eff6ff' : '#f8fafc',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '8px'
                        }}
                        onClick={() => document.getElementById(`upload-input-${mode}`).click()}
                    >
                        <input
                            id={`upload-input-${mode}`}
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                                if (e.target.files && e.target.files[0]) {
                                    setSelectedFile(e.target.files[0]);
                                    setFormData({ ...formData, image_url: '' });
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
                        value={formData.image_url || ''}
                        onChange={e => {
                            setFormData({ ...formData, image_url: e.target.value });
                            if (e.target.value) setSelectedFile(null);
                        }}
                        placeholder="https://exemplo.com/foto.jpg"
                        style={{ width: '100%', padding: '14px', borderRadius: '12px', border: typeof errors.image_url === 'string' ? '1px solid #ef4444' : '1px solid #cbd5e1', fontSize: '15px', outline: 'none', backgroundColor: '#fff', appearance: 'none', boxSizing: 'border-box' }}
                        onFocus={e => e.target.style.borderColor = '#94a3b8'}
                        onBlur={e => {
                            if (!errors.image_url) {
                                e.target.style.borderColor = '#cbd5e1';
                            }
                        }}
                    />
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e2e8f0' }}>
                <button type="submit" disabled={isSubmitting} style={{ width: '100%', background: isSubmitting ? '#cbd5e1' : (mode === 'admin' ? '#111827' : '#2563eb'), color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.7 : 1, transition: 'all 0.2s', boxShadow: mode === 'admin' ? 'none' : '0 4px 6px -1px rgba(37, 99, 235, 0.2)' }}>
                    {isSubmitting ? (
                        <>
                            <div style={{ width: '18px', height: '18px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
                            Gerando...
                        </>
                    ) : (
                        mode === 'admin' ? 'Gerar Matéria' : 'Extrair e Gerar IA'
                    )}
                </button>
                {onCancel && (
                    <button type="button" onClick={onCancel} style={{ background: 'transparent', color: '#64748b', border: 'none', padding: '16px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
                        Cancelar
                    </button>
                )}
            </div>
        </form>
    );
}
