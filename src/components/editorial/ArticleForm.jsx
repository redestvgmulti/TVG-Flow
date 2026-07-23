import React, { useState } from 'react';
import { ImageIcon, Video, CheckCircle2, Loader2 } from 'lucide-react';

// Static fallback used only when parent hasn't loaded campaigns from DB yet.
// Ensures backward compatibility if a parent doesn't pass availableCampaigns.
const FALLBACK_CAMPAIGNS = [
    { slug: 'individuais', label: 'Individuais' },
    { slug: 'natal',       label: 'Natal' },
    { slug: 'ano_novo',    label: 'Ano Novo' },
    { slug: 'dia_das_mulheres', label: 'Dia das Mulheres' },
    { slug: 'dia_dos_pais',    label: 'Dia dos Pais' },
];

export default function ArticleForm({
    mode = 'admin',
    formData,
    setFormData,
    errors = {},
    onSubmit,
    isSubmitting,
    onCancel,
    availableTemplates = [],
    // null  → not yet loaded, use static fallback (backward compat)
    // []    → loaded from DB, bank has no non-default campaigns
    // [...]  → loaded from DB, render these
    availableCampaigns = null,
    visualTitles = [],
    selectedFile,
    setSelectedFile
}) {
    // Resolve which campaigns to render in the dropdown
    const campaignOptions = availableCampaigns !== null ? availableCampaigns : FALLBACK_CAMPAIGNS;
    const [isDragging, setIsDragging] = useState(false);

    const hasErr = key => typeof errors[key] === 'string';
    const selectedVisual = formData.visual_title_id
        ? visualTitles.find(title => title.id === formData.visual_title_id)
        : null;

    return (
        <form onSubmit={onSubmit} className="ap-af">
            {/* Formato */}
            <div className="ap-af-format">
                {[
                    ['feed', 'Feed', <ImageIcon size={18} key="feed" />],
                    ['reels', 'Reels', <Video size={18} key="reels" />],
                ].map(([val, lbl, icon]) => (
                    <button
                        key={val}
                        type="button"
                        onClick={() => setFormData({ ...formData, content_type: val })}
                        className={`ap-af-format-btn${formData.content_type === val ? ' active' : ''}`}
                    >
                        {icon} <span style={{ whiteSpace: 'nowrap' }}>{lbl}</span>
                    </button>
                ))}
            </div>

            {/* Campanha + Template */}
            <div className="ap-af-panel">
                <div className="ap-field">
                    <label>Campanha</label>
                    <select
                        value={formData.template_set || 'default'}
                        onChange={e => setFormData({ ...formData, template_set: e.target.value, placid_template_uuid: null })}
                    >
                        <option value="default">Padrão</option>
                        {campaignOptions.map(c => (
                            <option key={c.slug} value={c.slug}>{c.label}</option>
                        ))}
                    </select>
                </div>
                {formData.template_set && formData.template_set !== 'default' && (
                    <div className={`ap-field${hasErr('placid_template_uuid') ? ' has-error' : ''}`}>
                        <label>Selecionar template</label>
                        <select
                            value={formData.placid_template_uuid || ''}
                            onChange={e => setFormData({ ...formData, placid_template_uuid: e.target.value })}
                        >
                            <option value="" disabled>Escolha um template...</option>
                            {availableTemplates.map(t => (
                                <option key={t.id} value={t.placid_template_uuid}>{t.nome}</option>
                            ))}
                        </select>
                        {hasErr('placid_template_uuid') && <span className="ap-field-error">{errors.placid_template_uuid}</span>}
                    </div>
                )}
            </div>

            {/* Selo da matéria (opcional) */}
            <div className="ap-field">
                <label>Selo da matéria <span className="ap-opt">(opcional)</span></label>
                <select value={formData.visual_title_id || ''} onChange={e => setFormData({ ...formData, visual_title_id: e.target.value || null })}>
                    <option value="">Sem selo da matéria</option>
                    {visualTitles.map(title => <option key={title.id} value={title.id}>{title.nome}</option>)}
                </select>
                {selectedVisual?.preview_url && (
                    <img src={selectedVisual.preview_url} alt="Preview do selo da matéria" className="ap-af-selo-preview" />
                )}
            </div>

            {/* Categoria editorial */}
            <div className={`ap-field${hasErr('context_tag') ? ' has-error' : ''}`}>
                <label>Categoria <span className="ap-req">*</span></label>
                <input
                    value={formData.context_tag || ''}
                    onChange={e => setFormData({ ...formData, context_tag: e.target.value.toUpperCase() })}
                    placeholder="Ex.: Entretenimento"
                />
            </div>

            {/* Link de origem */}
            <div className="ap-af-linkbox">
                <span className="ap-af-linkbox-label">Link da matéria <span className="ap-req">*</span></span>
                <p className="ap-af-linkbox-hint">A IA irá extrair o conteúdo desta URL.</p>
                <div className={`ap-field${hasErr('url_original') ? ' has-error' : ''}`}>
                    <input
                        value={formData.url_original || ''}
                        onChange={e => setFormData({ ...formData, url_original: e.target.value })}
                        placeholder="Cole aqui o link da notícia"
                    />
                    {hasErr('url_original') && <span className="ap-field-error">{errors.url_original}</span>}
                </div>
            </div>

            {/* Divisor */}
            <div className="ap-divider-ou"><span>Ou complete manualmente</span></div>

            {/* Título principal */}
            <div className={`ap-field${hasErr('titulo') ? ' has-error' : ''}`}>
                <label>Título principal <span className="ap-req">*</span></label>
                <input
                    value={formData.titulo || ''}
                    onChange={e => setFormData({ ...formData, titulo: e.target.value })}
                    placeholder="Ex.: Novo viaduto é inaugurado"
                />
                {hasErr('titulo') && <span className="ap-field-error">{errors.titulo}</span>}
            </div>

            {/* Texto base */}
            <div className={`ap-field${hasErr('conteudo') ? ' has-error' : ''}`}>
                <label>Texto da matéria <span className="ap-req">*</span></label>
                <textarea
                    value={formData.conteudo || ''}
                    onChange={e => setFormData({ ...formData, conteudo: e.target.value })}
                    placeholder="Escreva ou cole aqui o conteúdo base da notícia"
                    rows={4}
                    style={{ minHeight: '80px' }}
                />
            </div>

            {/* Foto (feed only) */}
            {formData.content_type === 'feed' && (
                <div className={`ap-field${hasErr('image_url') ? ' has-error' : ''}`}>
                    <label>Imagem da matéria</label>
                    <div
                        className={`ap-dropzone${isDragging ? ' dragging' : ''}`}
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
                                <div className="ap-dropzone-file">
                                    <CheckCircle2 size={16} /> {selectedFile.name}
                                </div>
                                <span className="ap-dropzone-sub">Clique para alterar</span>
                            </>
                        ) : (
                            <>
                                <div className="ap-dropzone-icon">
                                    <ImageIcon size={18} />
                                </div>
                                <span className="ap-dropzone-label">Clique ou arraste a imagem aqui</span>
                            </>
                        )}
                    </div>

                    <div className="ap-divider-ou"><span>Ou URL</span></div>

                    <input
                        value={formData.image_url || ''}
                        onChange={e => {
                            setFormData({ ...formData, image_url: e.target.value });
                            if (e.target.value) setSelectedFile(null);
                        }}
                        placeholder="https://exemplo.com/foto.jpg"
                    />
                    {hasErr('image_url') && <span className="ap-field-error">{errors.image_url}</span>}
                </div>
            )}

            {/* Rodapé */}
            <div className="ap-af-footer">
                <button type="submit" className="ap-modal-submit" disabled={isSubmitting}>
                    {isSubmitting ? (
                        <>
                            <Loader2 size={18} className="ap-spin-icon" />
                            Gerando...
                        </>
                    ) : (
                        mode === 'admin' ? 'Gerar Matéria' : 'Extrair e Gerar IA'
                    )}
                </button>
                {onCancel && (
                    <button type="button" className="ap-modal-cancel" onClick={onCancel}>
                        Cancelar
                    </button>
                )}
            </div>
        </form>
    );
}
