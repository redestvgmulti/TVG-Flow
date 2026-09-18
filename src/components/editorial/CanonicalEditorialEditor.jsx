import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { toast } from 'sonner'
import { BookOpen, FileText, Image as ImageIcon, Link2, Loader2, ScanText, Video } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { resolveOperationalClienteId } from '../../services/visualTitleGroups'
import { useEditorialCatalogs } from '../../hooks/useEditorialCatalogs'
import {
  EDITOR_MODES,
  allowedActionsForMode,
  canRetryDispatch,
  dispatchButtonLabel,
  messageForRpcError,
} from '../../services/editorialArticleContract'
import {
  buildDraftPayload,
  buildFinalizePayload,
  buildOriginPayload,
  buildProductionIntentPayload,
  scrapedResultToDraftFields,
  validateContentStep,
  validateOriginStep,
  validateProductionIntentStep,
} from '../../services/editorialArticleForm'
import {
  EditorialArticleError,
  approveEditorialArticleForRender,
  dispatchEditorialArticleRender,
  finalizeEditorialArticle,
  getEditorialArticleForEdit,
  requestEditorialArticleChanges,
  saveEditorialArticleDraft,
  saveEditorialArticleProductionIntent,
  scrapeArticleSource,
  startEditorialArticleDirect,
  uploadEditorialSourceImage,
} from '../../services/editorialArticlesService'
import {
  editorialEditorReducer,
  initialEditorialEditorState,
} from './canonicalEditor/editorialEditorReducer'
import { FieldError, FieldLabel } from './ArticleForm'
import VisualTitleCombobox from './VisualTitleCombobox'
import TerritorialComposerFields from './TerritorialComposerFields'
import ImageDropzone from './ImageDropzone'
import EditorialReasonModal from './EditorialReasonModal'
import { composerRequiresSourceImage } from '../../services/territorialComposer'
import '../../styles/AutoPublisher.css'
import '../../styles/CanonicalEditorialEditor.css'

const CONTENT_TYPE_ICONS = { feed: ImageIcon, reels: Video, story: BookOpen }
const ORIGIN_OPTIONS = [
  { value: 'link', label: 'Link', hint: 'Extrair de uma URL', icon: Link2 },
  { value: 'text', label: 'Texto', hint: 'Escrever manualmente', icon: FileText },
  { value: 'image', label: 'Imagem', hint: 'Partir de uma imagem', icon: ScanText },
]

function mintRequestId(store, key) {
  if (!store.current[key]) store.current[key] = crypto.randomUUID()
  return store.current[key]
}
function clearRequestId(store, key) {
  store.current[key] = null
}

// The one editor for both Admin and Staff, operating exclusively against
// ap.editorial_articles. Not wired into any production screen yet (2B.2.3) --
// this phase only needs it to work end to end against a real article_id.
export default function CanonicalEditorialEditor({
  articleId = null,
  originBacklog = null,
  currentUser = null,
  permissions = {},
  onArticleChange,
}) {
  const canReview = Boolean(permissions.canReview)
  const [clienteId, setClienteId] = useState(null)
  const [state, dispatch] = useReducer(editorialEditorReducer, initialEditorialEditorState())
  const [selectedFile, setSelectedFile] = useState(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isScraping, setIsScraping] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [reasonModalOpen, setReasonModalOpen] = useState(false)
  const requestIds = useRef({})

  useEffect(() => {
    let active = true
    resolveOperationalClienteId(supabase)
      .then(id => { if (active) setClienteId(id) })
      .catch(() => { if (active) toast.error('Não foi possível identificar o cliente operacional.') })
    return () => { active = false }
  }, [])

  const catalogs = useEditorialCatalogs(supabase, clienteId, state.form.content_type)

  const load = useCallback(async () => {
    if (!articleId) return
    dispatch({ type: 'LOAD_START' })
    try {
      const row = await getEditorialArticleForEdit(supabase, articleId)
      dispatch({ type: 'LOAD_SUCCESS', article: row })
    } catch (error) {
      dispatch({ type: 'LOAD_ERROR', error: { code: error instanceof EditorialArticleError ? error.code : 'UNKNOWN_ERROR' } })
    }
  }, [articleId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (state.article) onArticleChange?.(state.article)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.article])

  const isResponsible = !state.article || state.article.responsible_user_id === currentUser?.id
  const actions = allowedActionsForMode(state.mode, { isResponsible, canReview })
  const isReadOnly = !actions.canEditContent

  function setForm(updater) {
    setFieldErrors({})
    dispatch({ type: 'FIELD_CHANGE', updater })
  }

  function reportError(error, fallbackCode = 'UNKNOWN_ERROR') {
    const code = error instanceof EditorialArticleError ? error.code : fallbackCode
    toast.error(messageForRpcError(code).description)
    return code
  }

  // save/finalize/approve/requestChanges all RETURN ap.editorial_articles
  // (the bare table row) -- headline/body/revision_number only exist via a
  // join in get_editorial_article_for_edit. Dispatching the bare row into
  // fromArticle() would blank the visible content and freeze revisionNumber
  // (causing a false EDITORIAL_REVISION_CONFLICT on the very next save), so
  // every success path re-fetches the authoritative shape before updating
  // state, rather than assuming the mutating RPC's own return row is enough.
  async function refreshArticle(id) {
    return getEditorialArticleForEdit(supabase, id)
  }

  async function ensureArticleCreated() {
    if (state.articleId) return state.articleId
    const originErrors = validateOriginStep(state.form)
    if (Object.keys(originErrors).length) {
      setFieldErrors(originErrors)
      throw new EditorialArticleError('ORIGIN_REFERENCE_URL_REQUIRED')
    }
    const payload = buildOriginPayload(state.form, { requestId: mintRequestId(requestIds, 'create') })
    const created = await startEditorialArticleDirect(supabase, payload)
    clearRequestId(requestIds, 'create')
    dispatch({ type: 'ARTICLE_CREATED', article: created })
    return created.id
  }

  async function handleScrape() {
    const originErrors = validateOriginStep(state.form)
    if (Object.keys(originErrors).length) {
      setFieldErrors(originErrors)
      toast.error('Corrija os campos destacados.')
      return
    }
    setIsScraping(true)
    try {
      const result = await scrapeArticleSource(supabase, state.form.origin_reference)
      setForm(previous => ({ ...previous, ...scrapedResultToDraftFields(result) }))
      toast.success('Fonte analisada.')
    } catch (error) {
      reportError(error, 'SOURCE_SCRAPE_FAILED')
    } finally {
      setIsScraping(false)
    }
  }

  async function handleDropFile(file) {
    setSelectedFile(file)
    setIsUploading(true)
    try {
      const publicUrl = await uploadEditorialSourceImage(supabase, { file, folder: 'editorial_uploads' })
      setForm(previous => ({ ...previous, source_image_url: publicUrl }))
    } catch (error) {
      reportError(error, 'IMAGE_UPLOAD_FAILED')
      setSelectedFile(null)
    } finally {
      setIsUploading(false)
    }
  }

  // 'image' origin requires an http(s) origin_reference at the RPC level
  // (start_editorial_article_direct's CHECK), so the upload result seeds both
  // the immutable provenance field and the initial production source image.
  async function handleOriginImageUpload(file) {
    setSelectedFile(file)
    setIsUploading(true)
    try {
      const publicUrl = await uploadEditorialSourceImage(supabase, { file, folder: 'editorial_uploads' })
      setForm(previous => ({ ...previous, origin_reference: publicUrl, source_image_url: publicUrl }))
    } catch (error) {
      reportError(error, 'IMAGE_UPLOAD_FAILED')
      setSelectedFile(null)
    } finally {
      setIsUploading(false)
    }
  }

  async function handleSave() {
    setFieldErrors({})
    dispatch({ type: 'SAVE_START' })
    try {
      const savedArticleId = await ensureArticleCreated()
      let didMutate = false
      if (state.dirty.content || !state.articleId) {
        const contentErrors = validateContentStep(state.form)
        if (Object.keys(contentErrors).length) {
          setFieldErrors(contentErrors)
          toast.error('Corrija os campos destacados.')
          dispatch({ type: 'SAVE_ERROR', error: { code: 'EDITORIAL_CONTENT_REQUIRED' } })
          return
        }
        await saveEditorialArticleDraft(supabase, buildDraftPayload(state.form, {
          articleId: savedArticleId,
          requestId: mintRequestId(requestIds, 'draft'),
          expectedRevisionNumber: state.revisionNumber,
        }))
        clearRequestId(requestIds, 'draft')
        didMutate = true
      }
      if (state.dirty.productionIntent) {
        await saveEditorialArticleProductionIntent(supabase, buildProductionIntentPayload(state.form, {
          articleId: savedArticleId,
          requestId: mintRequestId(requestIds, 'productionIntent'),
          territorialComposerEnabled: catalogs.territorialComposerEnabled,
        }))
        clearRequestId(requestIds, 'productionIntent')
        didMutate = true
      }
      const refreshed = didMutate ? await refreshArticle(savedArticleId) : state.article
      dispatch({ type: 'SAVE_SUCCESS', article: refreshed })
      toast.success('Rascunho salvo.')
    } catch (error) {
      const code = reportError(error)
      dispatch({ type: code === 'EDITORIAL_REVISION_CONFLICT' ? 'SAVE_CONFLICT' : 'SAVE_ERROR', error: { code } })
    }
  }

  async function handleSubmitForReview() {
    setFieldErrors({})
    const contentErrors = validateContentStep(state.form)
    const intentErrors = validateProductionIntentStep(state.form, {
      territorialComposerEnabled: catalogs.territorialComposerEnabled,
      territorialCatalog: catalogs.territorialCatalog,
      masterConfigs: catalogs.masterRuntime?.configs,
      masterControl: { kill_switch: catalogs.masterRuntime?.killSwitch },
      poolCounts: catalogs.masterRuntime?.poolCounts,
    })
    if (Object.keys(contentErrors).length || Object.keys(intentErrors).length) {
      setFieldErrors({ ...contentErrors, ...intentErrors })
      toast.error('Corrija os campos destacados.')
      return
    }
    dispatch({ type: 'SUBMIT_START' })
    try {
      const submittedArticleId = await ensureArticleCreated()
      if (state.dirty.productionIntent || !state.articleId) {
        await saveEditorialArticleProductionIntent(supabase, buildProductionIntentPayload(state.form, {
          articleId: submittedArticleId,
          requestId: mintRequestId(requestIds, 'productionIntent'),
          territorialComposerEnabled: catalogs.territorialComposerEnabled,
        }))
        clearRequestId(requestIds, 'productionIntent')
      }
      await finalizeEditorialArticle(supabase, buildFinalizePayload(state.form, {
        articleId: submittedArticleId,
        requestId: mintRequestId(requestIds, 'finalize'),
        expectedRevisionNumber: state.revisionNumber,
      }))
      clearRequestId(requestIds, 'finalize')
      const refreshed = await refreshArticle(submittedArticleId)
      dispatch({ type: 'SUBMIT_SUCCESS', article: refreshed })
      toast.success('Enviado para revisão.')
    } catch (error) {
      const code = reportError(error)
      dispatch({ type: code === 'EDITORIAL_REVISION_CONFLICT' ? 'SUBMIT_CONFLICT' : 'SUBMIT_ERROR', error: { code } })
    }
  }

  // Approval and dispatch are chained (2B.2.3 sections 15-16): once
  // approve_editorial_article_for_render succeeds the article is already
  // ready_for_render, so the browser immediately attempts the handoff with
  // the approving admin's own live JWT (required by
  // create_territorial_composer_candidate, see ap-editorial-render-dispatch).
  // A dispatch failure never rolls back the approval -- handleDispatch
  // reports its own error and leaves the article exactly where APPROVE_SUCCESS
  // put it (ready_for_render), so the retry button below stays available.
  async function handleApprove() {
    dispatch({ type: 'APPROVE_START' })
    try {
      await approveEditorialArticleForRender(supabase, {
        articleId: state.articleId,
        expectedRevisionNumber: state.revisionNumber,
        requestId: mintRequestId(requestIds, 'approve'),
      })
      clearRequestId(requestIds, 'approve')
      const refreshed = await refreshArticle(state.articleId)
      dispatch({ type: 'APPROVE_SUCCESS', article: refreshed })
      toast.success('Aprovado para render.')
    } catch (error) {
      const code = reportError(error)
      dispatch({ type: code === 'EDITORIAL_REVISION_CONFLICT' ? 'APPROVE_CONFLICT' : 'APPROVE_ERROR', error: { code } })
      return
    }
    await handleDispatch()
  }

  async function handleDispatch() {
    dispatch({ type: 'DISPATCH_START' })
    try {
      await dispatchEditorialArticleRender(supabase, state.articleId)
      const refreshed = await refreshArticle(state.articleId)
      dispatch({ type: 'DISPATCH_SUCCESS', article: refreshed })
      toast.success('Enviado para renderização.')
    } catch {
      dispatch({ type: 'DISPATCH_ERROR', error: { code: 'DISPATCH_FAILED' } })
      toast.error('A matéria foi aprovada, mas o envio para renderização falhou. Tente novamente.')
    }
  }

  async function handleRequestChanges(reason) {
    dispatch({ type: 'REQUEST_CHANGES_START' })
    try {
      await requestEditorialArticleChanges(supabase, {
        articleId: state.articleId,
        reason,
        requestId: mintRequestId(requestIds, 'requestChanges'),
      })
      clearRequestId(requestIds, 'requestChanges')
      const refreshed = await refreshArticle(state.articleId)
      dispatch({ type: 'REQUEST_CHANGES_SUCCESS', article: refreshed })
      setReasonModalOpen(false)
      toast.success('Matéria devolvida para correção.')
    } catch (error) {
      const code = reportError(error)
      dispatch({ type: 'REQUEST_CHANGES_ERROR', error: { code } })
    }
  }

  const isBusy = state.status !== 'idle' && state.status !== 'loading' && state.status !== 'error'
  const sourceImageRequired = catalogs.territorialComposerEnabled
    ? composerRequiresSourceImage(catalogs.territorialCatalog, state.form.content_type)
    : catalogs.visualModelOptions.find(model => model.slug === state.form.visual_model)?.sourceImage === 'required'

  if (state.status === 'loading') {
    return <div className="ap-backlog-loading">Carregando matéria…</div>
  }

  return (
    <div className="ap-cee">
      {state.error && (
        <div role="alert" className="ap-af-alert ap-af-alert--error">
          {messageForRpcError(state.error.code).description}
        </div>
      )}

      {state.mode === EDITOR_MODES.CHANGES_REQUESTED && (
        <div className="ap-cee-banner ap-cee-banner--changes" role="status">
          <strong>Correção solicitada</strong>
          <span>O admin devolveu esta matéria para ajustes. Corrija e reenvie para revisão.</span>
        </div>
      )}

      {state.conflict && (
        <div className="ap-cee-banner ap-cee-banner--conflict" role="alert">
          <strong>Esta matéria foi atualizada em outra sessão.</strong>
          <span>Recarregue para continuar. Suas edições locais não foram perdidas ainda, mas não podem ser salvas por cima da versão mais recente.</span>
          <button type="button" className="ap-btn-refresh" onClick={() => void load()}>Recarregar</button>
        </div>
      )}

      {(state.mode === EDITOR_MODES.READ_ONLY) && (
        <div className="ap-cee-banner ap-cee-banner--readonly" role="status">
          <strong>Matéria congelada</strong>
          <span>
            {state.article?.status === 'dispatched' && 'Enviada para renderização.'}
            {state.article?.status === 'ready_for_render' && 'Aprovada e aguardando renderização.'}
            {state.article?.status === 'abandoned' && 'Esta matéria foi abandonada.'}
          </span>
          {canReview && canRetryDispatch(state.article?.status) && (
            <button type="button" className="ap-af-submit" disabled={isBusy} onClick={() => void handleDispatch()}>
              {state.status === 'dispatching' ? <Loader2 size={14} className="ap-spin-icon" /> : null}
              {' '}{dispatchButtonLabel(Boolean(state.error))}
            </button>
          )}
        </div>
      )}

      {originBacklog && (
        <div className="ap-cee-badge">Origem: Banco de pautas — {originBacklog.titulo || originBacklog.url_original}</div>
      )}

      {!state.articleId && (
        <section className="ap-cee-section" aria-label="Origem">
          <span className="ap-cee-section-title">Origem</span>
          <div className="ap-af-source-grid" role="group" aria-label="Origem da matéria">
            {ORIGIN_OPTIONS.map(option => {
              const Icon = option.icon
              const active = state.form.origin_type === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setForm(previous => ({ ...previous, origin_type: option.value, origin_reference: option.value === 'text' ? '' : previous.origin_reference }))}
                  className={`ap-af-source-btn${active ? ' ap-af-source-btn--active' : ''}`}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span><b>{option.label}</b><small>{option.hint}</small></span>
                </button>
              )
            })}
          </div>
          {state.form.origin_type === 'link' && (
            <div className="ap-af-linkbox">
              <FieldLabel required>Link de origem</FieldLabel>
              <input
                className={`ap-af-input${fieldErrors.origin_reference ? ' ap-af-input--error' : ''}`}
                value={state.form.origin_reference || ''}
                onChange={event => setForm(previous => ({ ...previous, origin_reference: event.target.value }))}
                placeholder="https://site.com/noticia..."
                inputMode="url"
              />
              <FieldError message={fieldErrors.origin_reference} />
              <button type="button" className="ap-af-alert-retry" disabled={isScraping} onClick={() => void handleScrape()}>
                {isScraping ? <Loader2 size={14} className="ap-spin-icon" /> : null} Analisar link
              </button>
            </div>
          )}
          {state.form.origin_type === 'image' && (
            <div className="ap-af-field">
              <FieldLabel required>Imagem de origem</FieldLabel>
              <ImageDropzone file={selectedFile} disabled={isUploading} onSelectFile={file => void handleOriginImageUpload(file)} />
              <FieldError message={fieldErrors.origin_reference} />
            </div>
          )}
        </section>
      )}

      {state.articleId && state.form.origin_type && (
        <section className="ap-cee-section" aria-label="Origem">
          <span className="ap-cee-section-title">Origem</span>
          <div className="ap-cee-badge">
            {state.form.origin_type === 'link' && `Link — ${state.form.origin_reference}`}
            {state.form.origin_type === 'text' && 'Texto direto'}
            {state.form.origin_type === 'image' && 'Imagem enviada diretamente'}
          </div>
        </section>
      )}

      <section className="ap-cee-section" aria-label="Conteúdo">
        <span className="ap-cee-section-title">Conteúdo</span>
        {isReadOnly ? (
          <div className="ap-cee-preview">
            <span className="ap-cee-preview-label">Manchete</span>
            <p className="ap-cee-preview-headline">{state.form.headline || '—'}</p>
            <span className="ap-cee-preview-label">Corpo</span>
            <p className="ap-cee-preview-body">{state.form.body || '—'}</p>
          </div>
        ) : (
          <>
            <div className="ap-af-field">
              <FieldLabel required>Manchete</FieldLabel>
              <input
                className={`ap-af-input${fieldErrors.headline ? ' ap-af-input--error' : ''}`}
                value={state.form.headline || ''}
                onChange={event => setForm(previous => ({ ...previous, headline: event.target.value }))}
                placeholder="Ex: Novo viaduto é inaugurado..."
              />
              <FieldError message={fieldErrors.headline} />
            </div>
            <div className="ap-af-field">
              <FieldLabel required>Corpo</FieldLabel>
              <textarea
                rows={5}
                className={`ap-af-textarea${fieldErrors.body ? ' ap-af-textarea--error' : ''}`}
                value={state.form.body || ''}
                onChange={event => setForm(previous => ({ ...previous, body: event.target.value }))}
                placeholder="Escreva os fatos confirmados."
              />
              <FieldError message={fieldErrors.body} />
            </div>
          </>
        )}
      </section>

      {sourceImageRequired && !isReadOnly && (
        <section className="ap-cee-section" aria-label="Imagem">
          <span className="ap-cee-section-title">Imagem</span>
          <ImageDropzone file={selectedFile} disabled={isUploading} onSelectFile={file => void handleDropFile(file)} />
          <input
            className="ap-af-input"
            value={state.form.source_image_url || ''}
            onChange={event => setForm(previous => ({ ...previous, source_image_url: event.target.value }))}
            placeholder="ou cole a URL de uma imagem"
          />
        </section>
      )}

      {!isReadOnly && (
        <section className="ap-cee-section" aria-label="Formato e visual">
          <span className="ap-cee-section-title">Formato e visual</span>
          <div className="ap-af-format" role="tablist">
            {catalogs.availableFormats.map(({ slug, label }) => {
              const Icon = CONTENT_TYPE_ICONS[slug] ?? ImageIcon
              const active = state.form.content_type === slug
              return (
                <button
                  key={slug}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setForm(previous => ({ ...previous, content_type: slug, visual_model: '', visual_title_id: null }))}
                  className={`ap-af-format-btn${active ? ' ap-af-format-btn--active' : ''}`}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
          <FieldError message={fieldErrors.content_type} />

          {!catalogs.territorialComposerEnabled && state.form.content_type && (
            <div className="ap-af-panel">
              <FieldLabel required>Finalidade da arte</FieldLabel>
              <div className="ap-af-vmodel-grid">
                {catalogs.visualModelOptions.map(model => {
                  const active = state.form.visual_model === model.slug
                  const disabled = !model.available
                  const cls = ['ap-af-vmodel-btn', active && 'ap-af-vmodel-btn--active', disabled && 'ap-af-vmodel-btn--disabled'].filter(Boolean).join(' ')
                  return (
                    <div key={model.slug} className="ap-af-vmodel-cell">
                      <button type="button" disabled={disabled} aria-pressed={active} className={cls}
                        onClick={() => setForm(previous => ({ ...previous, visual_model: model.slug }))}>
                        {model.label}
                      </button>
                      {disabled && model.unavailableReason && <small className="ap-af-vmodel-reason">{model.unavailableReason}</small>}
                    </div>
                  )
                })}
              </div>
              <FieldError message={fieldErrors.visual_model} />
            </div>
          )}

          {catalogs.territorialComposerEnabled && state.form.content_type && (
            <TerritorialComposerFields formData={state.form} setFormData={setForm} catalog={catalogs.territorialCatalog} errors={fieldErrors} />
          )}

          {!catalogs.territorialComposerEnabled && state.form.content_type && (
            <VisualTitleCombobox
              groups={catalogs.visualTitleGroups}
              value={state.form.visual_title_id || null}
              contentType={state.form.content_type}
              fieldError={fieldErrors.visual_title_id}
              onChange={visualTitleId => setForm(previous => ({ ...previous, visual_title_id: visualTitleId }))}
            />
          )}
        </section>
      )}

      <section className="ap-cee-section" aria-label="Preview">
        <div className="ap-cee-preview">
          <span className="ap-cee-preview-label">Preview editorial — não é o render final</span>
          <p className="ap-cee-preview-headline">{state.form.headline || 'Sem manchete ainda'}</p>
          <p className="ap-cee-preview-body">{state.form.body || 'Sem corpo ainda'}</p>
        </div>
      </section>

      {state.mode === EDITOR_MODES.REVIEW_PREVIEW && actions.canApprove && (
        <div className="ap-cee-review-actions">
          <button type="button" className="ap-af-submit" disabled={isBusy} onClick={() => void handleApprove()}>Aprovar para render</button>
          <button type="button" className="ap-af-cancel" disabled={isBusy} onClick={() => setReasonModalOpen(true)}>Devolver para correção</button>
        </div>
      )}

      {!isReadOnly && actions.canSave && (
        <div className="ap-cee-footer">
          <button type="button" className="ap-af-submit" disabled={isBusy} onClick={() => void handleSave()}>
            {state.status === 'saving' ? <Loader2 size={14} className="ap-spin-icon" /> : null} Salvar
          </button>
          {actions.canSubmitForReview && (
            <button type="button" className="ap-af-cancel" disabled={isBusy} onClick={() => void handleSubmitForReview()}>
              {state.mode === EDITOR_MODES.CHANGES_REQUESTED ? 'Reenviar para revisão' : 'Enviar para revisão'}
            </button>
          )}
        </div>
      )}

      <EditorialReasonModal
        isOpen={reasonModalOpen}
        isSubmitting={state.status === 'requestingChanges'}
        onClose={() => setReasonModalOpen(false)}
        onConfirm={reason => void handleRequestChanges(reason)}
        title="Devolver para correção"
        subtitle="Explique o que precisa ser ajustado antes de aprovar."
        label="Motivo"
        placeholder="Ex: ajustar a manchete e revisar o segundo parágrafo."
        confirmLabel="Devolver"
        required
        danger
      />
    </div>
  )
}
