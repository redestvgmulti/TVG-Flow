import React, { useEffect, useState } from 'react';
import { ImageIcon, Video, BookOpen, CheckCircle2, RefreshCcw } from 'lucide-react';
import VisualTitleCombobox from './VisualTitleCombobox';
import TerritorialComposerFields from './TerritorialComposerFields';
import { retainCompatibleVisualTitleId } from '../../services/visualTitleCatalog';
import {
    composerRequiresSourceImage,
} from '../../services/territorialComposer';

const FORMAT_ICONS = {
    feed: ImageIcon,
    reels: Video,
    story: BookOpen,
};

function FieldLabel({ children, required, optional }) {
    return (
        <label className="ap-af-label">
            <span>{children}</span>
            {required && <span className="ap-req" aria-hidden="true">*</span>}
            {optional && <span className="ap-opt">(opcional)</span>}
        </label>
    );
}

function FieldError({ message }) {
    if (!message) return null;
    return <span className="ap-field-error">{message}</span>;
}

const FORMAT_ICONS = {
    feed: ImageIcon,
    reels: Video,
    story: BookOpen,
};

function FieldLabel({ children, required, optional }) {
    return (
        <label className="ap-af-label">
            <span>{children}</span>
            {required && <span className="ap-req" aria-hidden="true">*</span>}
            {optional && <span className="ap-opt">(opcional)</span>}
        </label>
    );
}

function FieldError({ message }) {
    if (!message) return null;
    return <span className="ap-field-error">{message}</span>;
}

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
    const submissionDisabled = Boolean(isSubmitting || generationBlocked);
    const submitModifier = mode === 'admin' ? '' : 'ap-af-submit--employee';

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
        setVisualTitleFormatNotice(isCompatible ? '' : 'O selo selecionado não está disponível para este formato.');
    }

    function pickVisualModel(model) {
        if (model.sourceImage !== 'required') setSelectedFile(null);
        setFormData({
            ...formData,
            visual_model: model.slug,
            image_url: model.sourceImage === 'required' ? formData.image_url : '',
        });
    }

    function onDropFile(file) {
        if (!file) return;
        setSelectedFile(file);
        setFormData({ ...formData, image_url: '' });
    }

    return (
        <form onSubmit={onSubmit} className="ap-af">
            {/* Formato */}
            <div className="ap-af-format" role="tablist">
                {availableFormats.map(({ slug: val, label: lbl }) => {
                    const Icon = FORMAT_ICONS[val] ?? ImageIcon;
                    const active = formData.content_type === val;
                    return (
                        <button
                            key={val}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => selectContentType(val)}
                            className={`ap-af-format-btn${active ? ' ap-af-format-btn--active' : ''}`}
                        >
                            <Icon size={18} aria-hidden="true" />
                            <span>{lbl}</span>
                        </button>
                    );
                })}
            </div>

            {/* Modelo visual: junto com o formato, endereça o template fixo. */}
            {!territorialComposerEnabled && (visualModelsLoaded ? (
                <div className="ap-af-panel">
                    <FieldLabel required>Finalidade da arte</FieldLabel>
                    <div className="ap-af-vmodel-grid">
                        {visualModelOptions.map(model => {
                            const active = formData.visual_model === model.slug;
                            const disabled = !model.available;
                            const cls = [
                                'ap-af-vmodel-btn',
                                active && 'ap-af-vmodel-btn--active',
                                disabled && 'ap-af-vmodel-btn--disabled',
                            ].filter(Boolean).join(' ');
                            return (
                                <div key={model.slug} className="ap-af-vmodel-cell">
                                    <button
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => pickVisualModel(model)}
                                        aria-pressed={active}
                                        className={cls}
                                    >
                                        {model.label}
                                    </button>
                                    {disabled && model.unavailableReason && (
                                        <small className="ap-af-vmodel-reason">{model.unavailableReason}</small>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <FieldError message={typeof errors.visual_model === 'string' ? errors.visual_model : ''} />
                    <small className="ap-af-hint">A finalidade define a configuração da arte automaticamente.</small>
                </div>
            ) : visualModelsState === 'error' ? (
                <div role="alert" className="ap-af-alert ap-af-alert--error">
                    <span>Não foi possível carregar os modelos visuais. Tente novamente.</span>
                    <button type="button" onClick={onRetryVisualModels} className="ap-af-alert-retry">
                        <RefreshCcw size={14} aria-hidden="true" /> Recarregar configuração
                    </button>
                </div>
            ) : visualModelsState === 'empty' ? (
                <div role="status" className="ap-af-alert ap-af-alert--warning">
                    Nenhum modelo visual está habilitado para este formato.
                </div>
            ) : (
                <div role="status" className="ap-af-alert ap-af-alert--info">
                    Carregando modelos visuais...
                </div>
            ))}

            {territorialComposerEnabled && territorialComposerState === 'loading' && (
                <div role="status" className="ap-af-alert ap-af-alert--info">
                    Carregando compositor territorial...
                </div>
            )}
            {territorialComposerEnabled && territorialComposerState === 'error' && (
                <div role="alert" className="ap-af-alert ap-af-alert--error">
                    <span>{territorialComposerError || 'Não foi possível carregar o compositor territorial.'}</span>
                    <button type="button" onClick={onRetryTerritorialComposer} className="ap-af-alert-retry">Recarregar compositor</button>
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

            {/* Editoria (Tag) */}
            <div className="ap-af-field">
                <FieldLabel required>Editoria (Tag)</FieldLabel>
                <input
                    className={`ap-af-input${typeof errors.context_tag === 'string' ? ' ap-af-input--error' : ''}`}
                    value={formData.context_tag || ''}
                    onChange={e => setFormData({ ...formData, context_tag: e.target.value.toUpperCase() })}
                    placeholder="Ex: URGENTE"
                />
                <FieldError message={typeof errors.context_tag === 'string' ? errors.context_tag : ''} />
            </div>

            {/* Selo da matéria: o combobox preserva apenas visual_title_id. */}
            {!territorialComposerEnabled && <>
            <VisualTitleCombobox
                groups={visualTitleGroups}
                value={formData.visual_title_id || null}
                contentType={formData.content_type}
                loading={visualTitlesLoading}
                error={visualTitlesError}
                onRetry={onRetryVisualTitles}
                fieldError={typeof errors.visual_title_id === 'string' ? errors.visual_title_id : ''}
                onChange={visualTitleId => {
                    setVisualTitleFormatNotice('');
                    setFormData({ ...formData, visual_title_id: visualTitleId });
                }}
            />
            {visualTitleFormatNotice && (
                <small role="status" className="ap-af-hint ap-field-error">{visualTitleFormatNotice}</small>
            )}
            </>}

            {/* Link Origem */}
            <div className="ap-af-linkbox">
                <FieldLabel required>Link Origem</FieldLabel>
                <p className="ap-af-linkbox-hint">A IA irá extrair o conteúdo desta URL.</p>
                <input
                    className={`ap-af-input ap-af-input--link${typeof errors.url_original === 'string' ? ' ap-af-input--error' : ''}`}
                    value={formData.url_original || ''}
                    onChange={e => setFormData({ ...formData, url_original: e.target.value })}
                    placeholder="https://globo.com/noticia..."
                />
                <FieldError message={typeof errors.url_original === 'string' ? errors.url_original : ''} />
            </div>

            <div className="ap-af-divider">
                <span className="ap-af-divider__line" />
                <span className="ap-af-divider__label">Ou complete manualmente</span>
                <span className="ap-af-divider__line" />
            </div>

            {/* Headline */}
            <div className="ap-af-field">
                <FieldLabel required>Headline Maior</FieldLabel>
                <input
                    className={`ap-af-input${typeof errors.titulo === 'string' ? ' ap-af-input--error' : ''}`}
                    value={formData.titulo || ''}
                    onChange={e => setFormData({ ...formData, titulo: e.target.value })}
                    placeholder="Ex: Novo viaduto é inaugurado..."
                />
                <FieldError message={typeof errors.titulo === 'string' ? errors.titulo : ''} />
            </div>

            {/* Texto Base */}
            <div className="ap-af-field">
                <FieldLabel required>Texto Base da Matéria</FieldLabel>
                <textarea
                    rows={4}
                    className={`ap-af-textarea${typeof errors.conteudo === 'string' ? ' ap-af-textarea--error' : ''}`}
                    value={formData.conteudo || ''}
                    onChange={e => setFormData({ ...formData, conteudo: e.target.value })}
                    placeholder="Escreva a notícia base. A IA revisará e criará a caption com hashtags..."
                />
                <FieldError message={typeof errors.conteudo === 'string' ? errors.conteudo : ''} />
            </div>

            {/* Imagem aparece apenas quando o contrato da finalidade a utiliza. */}
            {sourceImageSupported && (
                <div className="ap-af-field">
                    <FieldLabel required={sourceImageRequired}>Foto (Fundo do Card)</FieldLabel>
                    <div
                        role="button"
                        tabIndex={0}
                        aria-label="Selecionar imagem"
                        className={`ap-af-dropzone${isDragging ? ' ap-af-dropzone--active' : ''}`}
                        onDragOver={e => {
                            e.preventDefault();
                            setIsDragging(true);
                        }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={e => {
                            e.preventDefault();
                            setIsDragging(false);
                            onDropFile(e.dataTransfer.files?.[0]);
                        }}
                        onClick={() => document.getElementById(`upload-input-${mode}`).click()}
                        onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                document.getElementById(`upload-input-${mode}`).click();
                            }
                        }}
                    >
                        <input
                            id={`upload-input-${mode}`}
                            type="file"
                            accept="image/*"
                            onChange={e => onDropFile(e.target.files?.[0])}
                        />

                        {selectedFile ? (
                            <>
                                <span className="ap-af-dropzone-chip">
                                    <CheckCircle2 size={16} aria-hidden="true" /> Arquivo Anexado: {selectedFile.name}
                                </span>
                                <span className="ap-af-dropzone-hint">Clique para alterar</span>
                            </>
                        ) : (
                            <>
                                <span className="ap-af-dropzone-circle">
                                    <ImageIcon size={20} aria-hidden="true" />
                                </span>
                                <span className="ap-af-dropzone-label">
                                    Clique ou arraste a imagem original aqui
                                </span>
                            </>
                        )}
                    </div>

                    <div className="ap-af-divider">
                        <span className="ap-af-divider__line" />
                        <span className="ap-af-divider__label ap-af-divider__label--subtle">OU URL</span>
                        <span className="ap-af-divider__line" />
                    </div>

                    <input
                        className={`ap-af-input${typeof errors.image_url === 'string' ? ' ap-af-input--error' : ''}`}
                        value={formData.image_url || ''}
                        onChange={e => {
                            setFormData({ ...formData, image_url: e.target.value });
                            if (e.target.value) setSelectedFile(null);
                        }}
                        placeholder="https://exemplo.com/foto.jpg"
                    />
                    <FieldError message={typeof errors.image_url === 'string' ? errors.image_url : ''} />
                </div>
            )}

            <div className="ap-af-footer">
                <button type="submit" disabled={submissionDisabled} className={`ap-af-submit ${submitModifier}`.trim()}>
                    {isSubmitting ? (
                        <>
                            <span className="ap-af-submit-spinner" aria-hidden="true" />
                            Gerando...
                        </>
                    ) : (
                        mode === 'admin' ? 'Gerar Matéria' : 'Extrair e Gerar IA'
                    )}
                </button>
                {onCancel && (
                    <button type="button" onClick={onCancel} className="ap-af-cancel">
                        Cancelar
                    </button>
                )}
            </div>
        </form>
    );
}
