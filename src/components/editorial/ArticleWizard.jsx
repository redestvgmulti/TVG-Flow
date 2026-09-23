import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ImageIcon, Video, BookOpen, Pencil, Check, Loader2 } from 'lucide-react';
import VisualTitleCombobox from './VisualTitleCombobox';
import TerritorialComposerFields from './TerritorialComposerFields';
import { FieldLabel, FieldError } from './ArticleForm';
import { retainCompatibleVisualTitleId, flattenVisualTitleGroups } from '../../services/visualTitleCatalog';
import { composerRequiresSourceImage, composerFormErrors } from '../../services/territorialComposer';
import { visualModelLabel } from '../../services/visualModels';

const FORMAT_ICONS = {
    feed: ImageIcon,
    reels: Video,
    story: BookOpen,
};

const STEP_COPY = {
    formato: {
        title: 'Como essa matéria vai ser publicada?',
        subtitle: 'O formato define a proporção da arte; a finalidade define o template usado pela IA.',
    },
    origem: {
        title: 'De onde vem o conteúdo?',
        subtitle: 'Importe de um link para a IA extrair o texto, ou escreva você mesmo a base da matéria.',
    },
    imagem: {
        title: 'Foto de fundo',
        subtitle: 'O template escolhido usa uma imagem original como fundo do card.',
    },
    revisao: {
        title: 'Confira antes de gerar',
        subtitle: 'Nada é publicado agora — a matéria entra na fila e você aprova o resultado depois.',
    },
};

// Maps a manualFormErrors key (set by AutoPublisher's submitManualNews on a
// failed submit) back to the wizard step where that field lives, so a submit
// failure jumps the user to the offending step instead of leaving them
// stranded on Revisão looking at a toast with nothing to fix in view.
const FIELD_TO_STEP = {
    content_type: 'formato',
    visual_model: 'formato',
    composer_mode: 'detalhes',
    visual_title_id: 'detalhes',
    region_id: 'detalhes',
    city_id: 'detalhes',
    manual_slots: 'detalhes',
    url_original: 'origem',
    titulo: 'origem',
    conteudo: 'origem',
    image_url: 'imagem',
};

export default function ArticleWizard({
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
    submitSucceeded = false,
    onCreateAnother,
    onBeforeReview,
    sourceLocked = false,
    fixedFiveSteps = false,
    showEditorialDraft = false,
    submitLabel = 'Gerar Matéria',
    preparationStatus = 'idle',
    automaticPreparationError = '',
    onRetryPreparation,
    onSaveDraft,
    isSavingDraft = false,
}) {
    const [step, setStep] = useState(0);
    const [maxReached, setMaxReached] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [visualTitleFormatNotice, setVisualTitleFormatNotice] = useState('');
    const [isPreparing, setIsPreparing] = useState(false);
    const [preparationError, setPreparationError] = useState('');

    // The parent flips submitSucceeded back to false both when the modal is
    // reopened fresh and when "Criar outra matéria" resets formData — either
    // way the wizard's own navigation needs to restart at step 0.
    useEffect(() => {
        if (!submitSucceeded) {
            setStep(0);
            setMaxReached(0);
        }
    }, [submitSucceeded]);

    const visualModelsLoaded = visualModelsState === 'available' ||
        (visualModelsState === 'empty' && visualModelOptions.length > 0);
    const selectedModel = availableVisualModels.find(model => model.slug === formData.visual_model);
    const sourceImageRequired = formData.content_type !== 'reels' && (territorialComposerEnabled
        ? composerRequiresSourceImage(territorialCatalog, formData.content_type)
        : selectedModel
            ? selectedModel.sourceImage === 'required'
            : false);

    const steps = useMemo(() => {
        const list = [
            { key: 'formato', label: 'Formato' },
            { key: 'origem', label: 'Origem' },
            { key: 'detalhes', label: 'Detalhes' },
        ];
        if (formData.source_mode !== 'link' && formData.content_type !== 'reels' && (fixedFiveSteps || sourceImageRequired)) list.push({ key: 'imagem', label: 'Imagem' });
        list.push({ key: 'revisao', label: 'Revisão' });
        return list;
    }, [fixedFiveSteps, sourceImageRequired, formData.content_type, formData.source_mode]);

    const currentIndex = Math.min(step, steps.length - 1);
    const currentStep = steps[currentIndex];
    const isLastStep = currentIndex === steps.length - 1;

    // Returns the reason "Continuar" is disabled for a step, or '' when the
    // step is complete — a single source of truth for both the boolean gate
    // and the footer's explanatory message (keeping the two from drifting
    // apart, since the message needs to name the actual missing field).
    function getBlocker(key) {
        switch (key) {
            case 'formato':
                if (territorialComposerEnabled) {
                    return territorialComposerState === 'ready'
                        ? ''
                        : territorialComposerState === 'error'
                            ? 'Não foi possível carregar a configuração editorial.'
                            : 'Aguardando o compositor territorial carregar.';
                }
                if (visualModelsState === 'loading') return 'Aguardando os modelos visuais carregarem.';
                if (visualModelsState === 'error') return 'Não foi possível carregar os modelos visuais.';
                if (visualModelsState !== 'available') return 'Nenhum modelo visual está disponível.';
                return formData.content_type && formData.visual_model
                    ? ''
                    : 'Escolha o formato e a finalidade da arte para continuar.';
            case 'origem':
                if (formData.source_mode === 'link') {
                    return (formData.url_original || '').trim() ? '' : 'Cole o link da matéria de origem.';
                }
                if (!(formData.titulo || '').trim()) return 'Preencha a headline maior.';
                if (!(formData.conteudo || '').trim()) return 'Preencha o texto base da matéria.';
                return '';
            case 'detalhes':
                if (territorialComposerEnabled) {
                    return Object.keys(composerFormErrors(formData, territorialCatalog)).length === 0
                        ? ''
                        : 'Complete a composição territorial para continuar.';
                }
                return formData.visual_title_id ? '' : 'Selecione o selo visual da peça.';
            case 'imagem':
                return !sourceImageRequired || selectedFile || (formData.image_url || '').trim()
                    ? ''
                    : 'Anexe uma foto ou informe a URL da imagem.';
            case 'revisao':
                return '';
            default:
                return '';
        }
    }

    const blocker = getBlocker(currentStep.key);
    const canContinue = !blocker;
    const formatLoading = currentStep.key === 'formato' && (
        territorialComposerEnabled
            ? territorialComposerState === 'loading' || territorialComposerState === 'idle'
            : visualModelsState === 'loading'
    );
    const stepCopy = currentStep.key === 'detalhes'
        ? {
            title: 'Classificação editorial',
            subtitle: territorialComposerEnabled
                ? 'O modo de composição resolve automaticamente o selo e os patrocinadores.'
                : 'O selo define a identidade visual aplicada e a categoria exibida na arte.',
        }
        : STEP_COPY[currentStep.key];
    const footerHint = formatLoading
        ? ''
        : blocker
        ? blocker
        : isLastStep
            ? 'Tudo certo. Nada é publicado sem sua aprovação.'
            : `Próximo: ${steps[currentIndex + 1]?.label ?? ''}`;

    // Submit failures (dedupe, scraping, upload...) are only detected inside
    // submitManualNews, after the wizard already let the user reach Revisão.
    useEffect(() => {
        const keys = Object.keys(errors || {});
        if (!keys.length) return;
        const targetKey = keys.map(key => FIELD_TO_STEP[key]).find(Boolean);
        if (!targetKey) return;
        const targetIndex = steps.findIndex(s => s.key === targetKey);
        if (targetIndex >= 0 && targetIndex !== step) {
            setMaxReached(m => Math.max(m, targetIndex));
            setStep(targetIndex);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [errors]);

    function goTo(index) {
        if (index >= 0 && index <= maxReached) setStep(index);
    }

    function handleBack() {
        setStep(s => Math.max(0, s - 1));
    }

    async function handleContinue() {
        if (!canContinue) return;
        const next = currentIndex + 1;
        if (steps[next]?.key === 'revisao' && onBeforeReview) {
            setIsPreparing(true);
            setPreparationError('');
            try {
                await onBeforeReview();
            } catch (error) {
                setPreparationError(error?.userMessage || 'Não foi possível preparar a matéria automaticamente.');
                return;
            } finally {
                setIsPreparing(false);
            }
        }
        setMaxReached(m => Math.max(m, next));
        setStep(next);
    }

    function selectContentType(contentType) {
        setStep(0);
        setMaxReached(0);
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
        setSelectedFile(null);
        setFormData(previous => ({ ...previous, content_type: contentType, visual_title_id: retainedId, visual_model: '', image_url: '' }));
        setVisualTitleFormatNotice(isCompatible ? '' : 'O selo selecionado não está disponível para este formato.');
    }

    function pickVisualModel(model) {
        if (model.sourceImage !== 'required') setSelectedFile(null);
        setFormData(previous => ({
            ...previous,
            visual_model: model.slug,
            image_url: model.sourceImage === 'required' ? previous.image_url : '',
        }));
    }

    function selectSourceMode(nextSourceMode) {
        // Clear the other mode's fields so a stale value can't silently
        // override the scraper (link mode) or linger unused (manual mode) —
        // submitManualNews decides link-vs-manual purely from url_original.
        setSelectedFile(null);
        setFormData(previous => ({
            ...previous,
            source_mode: nextSourceMode,
            ...(nextSourceMode === 'link' ? { titulo: '', conteudo: '' } : { url_original: '' }),
            image_url: '',
            idempotency_key: null,
        }));
    }

    function onDropFile(file) {
        if (!file) return;
        setSelectedFile(file);
        setFormData(previous => ({ ...previous, image_url: '', idempotency_key: null }));
    }

    function buildReviewRows() {
        const rows = [];
        if (territorialComposerEnabled) {
            const modeLabels = { editorial: 'Editorial', cities: 'Cidades', individual: 'Individual' };
            rows.push({ label: 'Modo de composição', value: modeLabels[formData.composer_mode] || '—', stepKey: 'detalhes' });
            if (formData.composer_mode === 'editorial') {
                const region = (territorialCatalog?.regions || []).find(r => r.id === formData.region_id);
                rows.push({ label: 'Região', value: region?.nome || '—', stepKey: 'detalhes' });
            }
            if (formData.composer_mode === 'cities') {
                const city = (territorialCatalog?.cities || []).find(c => c.id === formData.city_id);
                rows.push({ label: 'Cidade', value: city?.nome || '—', stepKey: 'detalhes' });
            }
        } else {
            const formatLabel = availableFormats.find(f => f.slug === formData.content_type)?.label || formData.content_type;
            rows.push({ label: 'Formato', value: `${formatLabel} · ${visualModelLabel(formData.visual_model)}`, stepKey: 'formato' });
            const selectedTitle = flattenVisualTitleGroups(visualTitleGroups).find(title => title.id === formData.visual_title_id);
            rows.push({ label: 'Selo', value: selectedTitle?.nome || '—', stepKey: 'detalhes' });
        }
        rows.push({
            label: 'Origem do conteúdo',
            value: formData.source_mode === 'link'
                ? `Link: ${formData.url_original || '—'}`
                : `Manual: ${formData.source_titulo || formData.titulo || '—'}`,
            stepKey: 'origem',
        });
        if (sourceImageRequired && formData.source_mode !== 'link') {
            rows.push({ label: 'Imagem', value: selectedFile?.name || formData.image_url || '—', stepKey: 'imagem' });
        }
        return rows;
    }

    function buildPipeline() {
        const formatLabel = availableFormats.find(f => f.slug === formData.content_type)?.label || formData.content_type;
        const templateLabel = territorialComposerEnabled
            ? ({ editorial: 'Editorial', cities: 'Cidades', individual: 'Individual' }[formData.composer_mode] || 'composição territorial')
            : visualModelLabel(formData.visual_model);
        return [
            formData.source_mode === 'link'
                ? 'A IA extrai e valida o texto da URL informada.'
                : 'O texto que você escreveu será mantido sem reescrita.',
            formData.source_mode === 'link'
                ? 'A legenda com hashtags é escrita automaticamente.'
                : 'A legenda será mantida conforme você escrever.',
            `A arte em ${formatLabel} é renderizada no template ${templateLabel}.`,
            'A matéria aparece na fila para sua aprovação antes de ser publicada.',
        ];
    }

    if (submitSucceeded) {
        return (
            <div className="ap-wizard">
                <div className="ap-wizard-content">
                    <div className="ap-wizard-done">
                        <div className="ap-wizard-done-icon"><Check size={28} strokeWidth={3} /></div>
                        <h4>Matéria criada!</h4>
                        <p>A IA está gerando a arte e a legenda. Acompanhe o status na lista de matérias.</p>
                    </div>
                </div>
                <div className="ap-wizard-footer">
                    <div className="ap-wizard-footer-actions ap-wizard-footer-actions--done">
                        <button type="button" className="ap-af-cancel" onClick={onCreateAnother}>Criar outra matéria</button>
                        <button type="button" className="ap-af-submit" onClick={onCancel}>Fechar</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <form onSubmit={onSubmit} className="ap-wizard">
            <div className="ap-wizard-steps">
                {steps.map((s, index) => {
                    const isDone = index < step;
                    const isCurrent = index === step;
                    const reachable = index <= maxReached;
                    return (
                        <div key={s.key} className="ap-wizard-step">
                            <div className="ap-wizard-step-node">
                                <button
                                    type="button"
                                    className={`ap-wizard-step-circle${isDone ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`}
                                    disabled={!reachable}
                                    onClick={() => goTo(index)}
                                >
                                    {isDone ? <Check size={13} strokeWidth={3} /> : index + 1}
                                </button>
                                <span className={`ap-wizard-step-label${isCurrent ? ' is-current' : ''}`}>{s.label}</span>
                            </div>
                            {index < steps.length - 1 && (
                                <div className={`ap-wizard-step-line${index < step ? ' is-done' : ''}`} />
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="ap-wizard-content">
                <div className="ap-wizard-step-copy">
                    <div className="ap-wizard-section-title-main">{stepCopy.title}</div>
                    <div className="ap-wizard-section-title-sub">{stepCopy.subtitle}</div>
                </div>

                {preparationStatus === 'preparing' && (
                    <div role="status" aria-live="polite" className="ap-af-alert ap-af-alert--info">
                        <Loader2 size={14} className="ap-spin-icon" /> Preparando matéria...
                    </div>
                )}
                {preparationStatus === 'error' && (
                    <div role="alert" className="ap-af-alert ap-af-alert--error">
                        <span>{automaticPreparationError || 'Não foi possível preparar a matéria automaticamente.'}</span>
                        <button type="button" className="ap-af-alert-retry" onClick={onRetryPreparation}>Tentar novamente</button>
                    </div>
                )}

                {currentStep.key === 'formato' && (
                    <div className="ap-wizard-panel">
                        {availableFormats.length > 0 && <div className="ap-af-format" role="tablist">
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
                        </div>}

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
                                <small className="ap-af-hint">A finalidade define a configuração da arte automaticamente.</small>
                            </div>
                        ) : visualModelsState === 'error' ? (
                            <div role="alert" className="ap-af-alert ap-af-alert--error">
                                <span>Não foi possível carregar os modelos visuais. Tente novamente.</span>
                                <button type="button" onClick={onRetryVisualModels} className="ap-af-alert-retry">Recarregar configuração</button>
                            </div>
                        ) : visualModelsState === 'empty' ? (
                            <div role="status" className="ap-af-alert ap-af-alert--warning">Nenhum modelo visual está habilitado para este formato.</div>
                        ) : null)}

                        {territorialComposerEnabled && territorialComposerState === 'error' && (
                            <div role="alert" className="ap-af-alert ap-af-alert--error">
                                <span>{territorialComposerError || 'Não foi possível carregar o compositor territorial.'}</span>
                                <button type="button" onClick={onRetryTerritorialComposer} className="ap-af-alert-retry">Recarregar compositor</button>
                            </div>
                        )}
                    </div>
                )}

                {currentStep.key === 'origem' && (
                    <div className="ap-wizard-panel">
                        <div className="ap-wizard-origin-grid">
                            {[
                                { value: 'link', label: 'Importar de um link', desc: 'A IA extrai headline e texto direto da URL.' },
                                { value: 'manual', label: 'Escrever manualmente', desc: 'Você digita a headline e o texto base.' },
                            ].map(option => {
                                const active = (formData.source_mode || 'link') === option.value;
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        disabled={sourceLocked}
                                        className={`ap-wizard-origin-btn${active ? ' is-active' : ''}`}
                                        onClick={() => selectSourceMode(option.value)}
                                    >
                                        <span className="ap-wizard-origin-btn-label">{option.label}</span>
                                        <span className="ap-wizard-origin-btn-desc">{option.desc}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {(formData.source_mode || 'link') === 'link' ? (
                            <div className="ap-af-linkbox">
                                <FieldLabel required>Link de origem</FieldLabel>
                                <p className="ap-af-linkbox-hint">A IA irá extrair e validar o conteúdo desta URL.</p>
                                <input
                                    className={`ap-af-input ap-af-input--link${typeof errors.url_original === 'string' ? ' ap-af-input--error' : ''}`}
                                    disabled={sourceLocked}
                                    value={formData.url_original || ''}
                                    onChange={e => setFormData({ ...formData, url_original: e.target.value, idempotency_key: null })}
                                    placeholder="https://site.com/noticia..."
                                    inputMode="url"
                                />
                                <FieldError message={typeof errors.url_original === 'string' ? errors.url_original : ''} />
                            </div>
                        ) : (
                            <>
                                <div className="ap-af-field">
                                    <FieldLabel required>Headline Maior</FieldLabel>
                                    <input
                                        className={`ap-af-input${typeof errors.titulo === 'string' ? ' ap-af-input--error' : ''}`}
                                        disabled={sourceLocked}
                                        value={sourceLocked ? (formData.source_titulo || '') : (formData.titulo || '')}
                                        onChange={e => setFormData({ ...formData, titulo: e.target.value, idempotency_key: null })}
                                        placeholder="Ex: Novo viaduto é inaugurado..."
                                    />
                                    <FieldError message={typeof errors.titulo === 'string' ? errors.titulo : ''} />
                                </div>
                                <div className="ap-af-field">
                                    <FieldLabel required>Texto Base da Matéria</FieldLabel>
                                    <textarea
                                        rows={5}
                                        className={`ap-af-textarea${typeof errors.conteudo === 'string' ? ' ap-af-textarea--error' : ''}`}
                                        disabled={sourceLocked}
                                        value={sourceLocked ? (formData.source_conteudo || '') : (formData.conteudo || '')}
                                        onChange={e => setFormData({ ...formData, conteudo: e.target.value, idempotency_key: null })}
                                        placeholder="Escreva os fatos confirmados. A IA revisará e criará a legenda."
                                    />
                                    <FieldError message={typeof errors.conteudo === 'string' ? errors.conteudo : ''} />
                                </div>
                            </>
                        )}
                    </div>
                )}

                {currentStep.key === 'detalhes' && (
                    <div className="ap-wizard-panel">
                        {territorialComposerEnabled ? (
                            <TerritorialComposerFields
                                formData={formData}
                                setFormData={setFormData}
                                catalog={territorialCatalog}
                                errors={errors}
                            />
                        ) : (
                            <>
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
                            </>
                        )}
                    </div>
                )}

                {currentStep.key === 'imagem' && (
                    <div className="ap-wizard-panel">
                        <div className="ap-af-field">
                            <FieldLabel required={sourceImageRequired}>Foto (Fundo do Card)</FieldLabel>
                            {!sourceImageRequired && <small className="ap-af-hint">Opcional para esta configuração.</small>}
                            <div
                                role="button"
                                tabIndex={0}
                                aria-label="Selecionar imagem"
                                className={`ap-af-dropzone${isDragging ? ' ap-af-dropzone--active' : ''}`}
                                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={e => { e.preventDefault(); setIsDragging(false); onDropFile(e.dataTransfer.files?.[0]); }}
                                onClick={() => document.getElementById('upload-input-wizard').click()}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        document.getElementById('upload-input-wizard').click();
                                    }
                                }}
                            >
                                <input
                                    id="upload-input-wizard"
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
                                        <span className="ap-af-dropzone-label">Clique ou arraste a imagem original aqui</span>
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
                                    setFormData({ ...formData, image_url: e.target.value, idempotency_key: null });
                                    if (e.target.value) setSelectedFile(null);
                                }}
                                placeholder="https://exemplo.com/foto.jpg"
                            />
                            <FieldError message={typeof errors.image_url === 'string' ? errors.image_url : ''} />
                        </div>
                    </div>
                )}

                {currentStep.key === 'revisao' && (
                    <div className="ap-wizard-panel">
                        {showEditorialDraft && <div className="ap-af-field">
                            <FieldLabel required>Headline</FieldLabel>
                            <input
                                className={`ap-af-input${typeof errors.titulo === 'string' ? ' ap-af-input--error' : ''}`}
                                value={formData.titulo || ''}
                                onChange={e => setFormData({ ...formData, titulo: e.target.value, idempotency_key: null })}
                            />
                            <FieldError message={typeof errors.titulo === 'string' ? errors.titulo : ''} />
                        </div>}
                        {showEditorialDraft && <div className="ap-af-field">
                            <FieldLabel required>Corpo da matéria</FieldLabel>
                            <textarea
                                rows={7}
                                className={`ap-af-textarea${typeof errors.conteudo === 'string' ? ' ap-af-textarea--error' : ''}`}
                                value={formData.conteudo || ''}
                                onChange={e => setFormData({ ...formData, conteudo: e.target.value, idempotency_key: null })}
                            />
                            <FieldError message={typeof errors.conteudo === 'string' ? errors.conteudo : ''} />
                        </div>}
                        {showEditorialDraft && <div className="ap-af-field">
                            <FieldLabel required={formData.source_mode !== 'manual'}>Legenda</FieldLabel>
                            <textarea
                                rows={4}
                                className={`ap-af-textarea${typeof errors.caption === 'string' ? ' ap-af-textarea--error' : ''}`}
                                value={formData.caption || ''}
                                onChange={e => setFormData({ ...formData, caption: e.target.value, idempotency_key: null })}
                            />
                            <FieldError message={typeof errors.caption === 'string' ? errors.caption : ''} />
                        </div>}
                        <div className="ap-wizard-review">
                            {buildReviewRows().map(row => (
                                <div key={row.label} className="ap-wizard-review-row">
                                    <div className="ap-wizard-review-row-text">
                                        <div className="ap-wizard-review-row-label">{row.label}</div>
                                        <div className="ap-wizard-review-row-value">{row.value}</div>
                                    </div>
                                    <button
                                        type="button"
                                        className="ap-wizard-review-row-edit"
                                        onClick={() => goTo(steps.findIndex(s => s.key === row.stepKey))}
                                    >
                                        <Pencil size={13} aria-hidden="true" /> Editar
                                    </button>
                                </div>
                            ))}
                        </div>

                        <div className="ap-wizard-pipeline">
                            <div className="ap-wizard-pipeline-title">O que acontece depois de gerar</div>
                            {buildPipeline().map((text, index) => (
                                <div key={index} className="ap-wizard-pipeline-row">
                                    <span className="ap-wizard-pipeline-num">{index + 1}</span>
                                    <span className="ap-wizard-pipeline-text">{text}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="ap-wizard-footer">
                <div className={`ap-wizard-footer-hint${blocker || preparationError || automaticPreparationError ? ' is-blocked' : ''}`} role={preparationError || automaticPreparationError ? 'alert' : undefined}>
                    {isPreparing || preparationStatus === 'preparing' ? 'Preparando matéria...' : preparationError || automaticPreparationError || footerHint}
                </div>
                <div className="ap-wizard-footer-actions">
                    {step === 0 ? (
                        <button key="cancel" type="button" className="ap-af-cancel" onClick={onCancel}>Cancelar</button>
                    ) : (
                        <button key="back" type="button" className="ap-wizard-back-btn" onClick={handleBack}>← Voltar</button>
                    )}
                    {isLastStep ? (
                        <>
                            {onSaveDraft && (
                                <button type="button" disabled={isSubmitting || isSavingDraft} className="ap-wizard-back-btn" onClick={() => void onSaveDraft()}>
                                    {isSavingDraft ? 'Salvando...' : 'Salvar rascunho'}
                                </button>
                            )}
                            {/* Distinct `key` from the Continuar button below is load-bearing, not
                                decorative: it prevents the advancing click from becoming submit. */}
                            <button key="submit" type="submit" disabled={isSubmitting || isSavingDraft} className="ap-af-submit">
                                {isSubmitting ? (<><span className="ap-af-submit-spinner" aria-hidden="true" />Enviando...</>) : submitLabel}
                            </button>
                        </>
                    ) : (
                        <button key="continue" type="button" disabled={!canContinue || isPreparing} className="ap-af-submit" onClick={() => void handleContinue()}>
                            {isPreparing ? 'Preparando matéria...' : 'Continuar →'}
                        </button>
                    )}
                </div>
            </div>
        </form>
    );
}
