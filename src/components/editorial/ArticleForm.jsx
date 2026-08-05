import React, { useEffect, useState } from 'react';
import { ImageIcon, Video, BookOpen, CheckCircle2, RefreshCcw } from 'lucide-react';
import VisualTitleCombobox from './VisualTitleCombobox';
import TerritorialComposerFields from './TerritorialComposerFields';
import { retainCompatibleVisualTitleId } from '../../services/visualTitleCatalog';
import {
    composerRequiresSourceImage,
} from '../../services/territorialComposer';

export default function ArticleForm({
    mode = 'admin',
    formData,
    setFormData,
    errors = {},
    onSubmit,
    isSubmitting,
    onCancel,
    availableVisualModels = [],
    visualModelOptions = [],
    availableFormats = [],
    visualTitleGroups = [],
    visualTitlesLoading = false,
    visualTitlesError = '',
    onRetryVisualTitles,
    visualModelsState = 'loading',
    onRetryVisualModels,
    selectedFile,
    setSelectedFile,
    territorialComposerEnabled = false,
    territorialCatalog = null,
    territorialComposerState = 'disabled',
    territorialComposerError = '',
    onRetryTerritorialComposer,
}) {
    const [isDragging, setIsDragging] = useState(false);
    const [visualTitleFormatNotice, setVisualTitleFormatNotice] = useState('');
    const visualModelsLoaded = visualModelsState === 'available' ||
        (visualModelsState === 'empty' && visualModelOptions.length > 0);
    const generationBlocked = territorialComposerEnabled
        ? territorialComposerState !== 'ready'
        : visualModelsState !== 'available' || !formData.visual_model || !formData.visual_title_id;
    const selectedModel = availableVisualModels.find(model => model.slug === formData.visual_model);
    const availableModelsRequireSourceImage = availableVisualModels.length > 0 &&
        availableVisualModels.every(model => model.sourceImage === 'required');
    const sourceImageRequired = territorialComposerEnabled
        ? composerRequiresSourceImage(territorialCatalog, formData.content_type)
        : selectedModel
            ? selectedModel.sourceImage === 'required'
            : !formData.visual_model && availableModelsRequireSourceImage;
    const sourceImageSupported = sourceImageRequired;

    useEffect(() => {
        if (territorialComposerEnabled) return;
        if (visualModelsState !== 'available') return;
        const selectedStillValid = availableVisualModels.some(model => model.slug === formData.visual_model);
        const nextModel = selectedStillValid
            ? formData.visual_model
            : (availableVisualModels.length === 1 ? availableVisualModels[0].slug : '');
        if (nextModel !== formData.visual_model) {
            setFormData(previous => ({ ...previous, visual_model: nextModel }));
        }
    }, [availableVisualModels, formData.visual_model, setFormData, territorialComposerEnabled, visualModelsState]);

    function selectContentType(contentType) {
        if (territorialComposerEnabled) {
            setSelectedFile(null);
            setVisualTitleFormatNotice('');
            setFormData(previous => ({
                ...previous,
                content_type: contentType,
                visual_model: '',
                visual_title_id: null,
                region_id: null,
                city_id: null,
                manual_slots: [],
                image_url: '',
                idempotency_key: null,
            }));
            return;
        }
        const retainedId = retainCompatibleVisualTitleId(visualTitleGroups, formData.visual_title_id, contentType);
        const isCompatible = !formData.visual_title_id || retainedId === formData.visual_title_id;
        // A model is only offered when its master config exists for the format,
        // so drop it and let the operator re-pick one that actually exists.
        setSelectedFile(null);
        setFormData({ ...formData, content_type: contentType, visual_title_id: retainedId, visual_model: '', image_url: '' });
        setVisualTitleFormatNotice(isCompatible ? '' : 'O selo selecionado n\u00e3o est\u00e1 dispon\u00edvel para este formato.');
    }

    return (
        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
            {/* Formato */}
            <div style={{ display: 'flex', gap: '8px', background: '#f1f5f9', padding: '6px', borderRadius: '16px', flexWrap: 'wrap' }}>
                {availableFormats.map(({ slug: val, label: lbl }) => {
                    const icon = val === 'feed'
                        ? <ImageIcon size={18} key="feed" />
                        : val === 'reels'
                            ? <Video size={18} key="reels" />
                            : <BookOpen size={18} key="story" />;
                    return (
                    <button key={val} type="button" onClick={() => selectContentType(val)}
                        style={{ flex: '1 1 120px', padding: '10px 8px', borderRadius: '12px', border: 'none', background: formData.content_type === val ? '#fff' : 'transparent', color: formData.content_type === val ? '#0f172a' : '#64748b', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', boxShadow: formData.content_type === val ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', cursor: 'pointer', transition: 'all 0.2s' }}>
                        {icon} <span style={{ whiteSpace: 'nowrap' }}>{lbl}</span>
                    </button>
                    );
                })}
            </div>

            {/* Modelo visual: junto com o formato, endereça o template fixo. */}
            {!territorialComposerEnabled && (visualModelsLoaded ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: '#f8fafc', padding: '16px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                    <label style={{ fontSize: '13px', fontWeight: 600, color: '#334155' }}>Finalidade da arte <span style={{ color: '#ef4444' }}>*</span></label>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {visualModelOptions.map(model => (
                            <div key={model.slug} style={{ flex: '1 1 140px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <button type="button" disabled={!model.available}
                                onClick={() => {
                                    if (model.sourceImage !== 'required') setSelectedFile(null);
                                    setFormData({
                                        ...formData,
                                        visual_model: model.slug,
                                        image_url: model.sourceImage === 'required' ? formData.image_url : '',
                                    });
                                }}
                                aria-pressed={formData.visual_model === model.slug}
                                style={{ width: '100%', padding: '12px 10px', borderRadius: '12px', border: formData.visual_model === model.slug ? '1px solid #0f172a' : '1px solid #cbd5e1', background: formData.visual_model === model.slug ? '#0f172a' : '#fff', color: formData.visual_model === model.slug ? '#fff' : '#334155', fontWeight: 600, fontSize: '14px', cursor: model.available ? 'pointer' : 'not-allowed', opacity: model.available ? 1 : 0.55, transition: 'all 0.2s' }}>
                                {model.label}
                            </button>
                            {!model.available && <small style={{ color: '#64748b', lineHeight: 1.25 }}>{model.unavailableReason}</small>}
                            </div>
                        ))}
                    </div>
                    {typeof errors.visual_model === 'string' && <span style={{ color: '#ef4444', fontSize: '12px', fontWeight: 600 }}>{errors.visual_model}</span>}
                    <small style={{ color: '#64748b' }}>A finalidade define a configuração da arte automaticamente.</small>
                </div>
            ) : visualModelsState === 'error' ? (
                <div role="alert" style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: '12px', padding: '14px 16px', fontSize: '13px', color: '#991b1b', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '10px' }}>
                    <span>Não foi possível carregar os modelos visuais. Tente novamente.</span>
                    <button type="button" onClick={onRetryVisualModels} style={{ border: '1px solid #ef4444', background: '#fff', color: '#991b1b', borderRadius: '8px', padding: '8px 10px', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <RefreshCcw size={14} /> Recarregar configuração
                    </button>
                </div>
            ) : visualModelsState === 'empty' ? (
                <div role="status" style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '12px', padding: '14px 16px', fontSize: '13px', color: '#92400e' }}>
                    Nenhum modelo visual está habilitado para este formato.
                </div>
            ) : (
                <div role="status" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px 16px', fontSize: '13px', color: '#475569' }}>
                    Carregando modelos visuais...
                </div>
            ))}

            {territorialComposerEnabled && territorialComposerState === 'loading' && (
                <div role="status" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, color: '#475569' }}>
                    Carregando compositor territorial...
                </div>
            )}
            {territorialComposerEnabled && territorialComposerState === 'error' && (
                <div role="alert" style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 12, padding: 14, color: '#991b1b', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <span>{territorialComposerError || 'N\u00e3o foi poss\u00edvel carregar o compositor territorial.'}</span>
                    <button type="button" onClick={onRetryTerritorialComposer} style={{ alignSelf: 'flex-start', border: '1px solid #ef4444', background: '#fff', color: '#991b1b', borderRadius: 8, padding: '8px 10px', fontWeight: 600, cursor: 'pointer' }}>Recarregar compositor</button>
                </div>
            )}
            {territorialComposerEnabled && territorialComposerState === 'ready' && (
                <TerritorialComposerFields
                    formData={formData}
                    setFormData={setFormData}
                    catalog={territorialCatalog}
                    errors={errors}
                />
            )}


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

            {/* Selo da mat\u00e9ria: o combobox preserva apenas visual_title_id. */}
            {!territorialComposerEnabled && <>

            <VisualTitleCombobox
                groups={visualTitleGroups}
                value={formData.visual_title_id || null}
                contentType={formData.content_type}
                loading={visualTitlesLoading}
                error={visualTitlesError}
                onRetry={onRetryVisualTitles}
                fieldError={typeof errors.visual_title_id === 'string' ? errors.visual_title_id : ''}
                onChange={visualTitleId => { setVisualTitleFormatNotice(''); setFormData({ ...formData, visual_title_id: visualTitleId }); }}
            />
            {visualTitleFormatNotice && <small role="status" style={{ color: '#92400e' }}>{visualTitleFormatNotice}</small>}

            </>}
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

            {/* Imagem aparece apenas quando o contrato da finalidade a utiliza. */}
            {sourceImageSupported && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                    <label style={{ fontSize: '14px', fontWeight: 600, color: '#334155' }}>Foto (Fundo do Card){sourceImageRequired && <span style={{ color: '#ef4444' }}> *</span>}</label>
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
                <button type="submit" disabled={isSubmitting || generationBlocked} style={{ width: '100%', background: isSubmitting || generationBlocked ? '#cbd5e1' : (mode === 'admin' ? '#111827' : '#2563eb'), color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 600, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: isSubmitting || generationBlocked ? 'not-allowed' : 'pointer', opacity: isSubmitting || generationBlocked ? 0.7 : 1, transition: 'all 0.2s', boxShadow: mode === 'admin' ? 'none' : '0 4px 6px -1px rgba(37, 99, 235, 0.2)' }}>
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
