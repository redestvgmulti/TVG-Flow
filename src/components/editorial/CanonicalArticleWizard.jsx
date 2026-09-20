import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import ArticleWizard from './ArticleWizard'
import { supabase } from '../../services/supabase'
import { messageForRpcError } from '../../services/editorialArticleContract'
import {
  buildDraftPayload,
  buildFinalizePayload,
  buildProductionIntentPayload,
  validateContentStep,
  validateProductionIntentStep,
} from '../../services/editorialArticleForm'
import {
  approveEditorialArticleForRender,
  captureCollectedNewsArticleSource,
  captureEditorialArticleSource,
  dispatchEditorialArticleRender,
  finalizeEditorialArticle,
  getEditorialAiDraftStatus,
  getEditorialArticleForEdit,
  prepareEditorialAiDraft,
  requestEditorialArticleChanges,
  saveEditorialArticleDraft,
  saveEditorialArticleProductionIntent,
  scrapeArticleSource,
  startEditorialArticleDirect,
  uploadEditorialSourceImage,
} from '../../services/editorialArticlesService'

function requestId(store, key) {
  if (!store.current[key]) store.current[key] = crypto.randomUUID()
  return store.current[key]
}

function resetRequestId(store, key) {
  store.current[key] = null
}

function userFacingError(error) {
  const code = error?.code || error?.message || 'UNKNOWN_ERROR'
  const friendly = messageForRpcError(code).description
  const wrapped = new Error(code)
  wrapped.userMessage = friendly === messageForRpcError('UNKNOWN_ERROR').description
    ? 'Não foi possível preparar a matéria automaticamente. Tente novamente.'
    : friendly
  return wrapped
}

function canonicalFormFromWizard(formData, sourceImageUrl) {
  return {
    origin_type: formData.source_mode === 'link' ? 'link' : 'text',
    origin_reference: formData.source_mode === 'link' ? formData.url_original : '',
    production_input_type: formData.source_mode === 'link' ? 'link' : 'text',
    headline: formData.titulo,
    body: formData.conteudo,
    caption: formData.caption,
    context_tag: formData.context_tag,
    category: formData.category,
    location: formData.location || { city: null, region: null, state: null },
    content_type: formData.content_type,
    visual_model: formData.visual_model,
    visual_title_id: formData.visual_title_id,
    composer_mode: formData.composer_mode,
    region_id: formData.region_id,
    city_id: formData.city_id,
    manual_slots: formData.manual_slots,
    source_image_url: sourceImageUrl || formData.image_url || '',
  }
}

export default function CanonicalArticleWizard({
  articleId = null,
  originBacklog = null,
  formData,
  setFormData,
  onCancel,
  onComplete,
  onCreateAnother,
  availableVisualModels = [],
  visualModelOptions = [],
  availableFormats = [],
  visualTitleGroups = [],
  visualTitlesLoading = false,
  visualTitlesError = '',
  onRetryVisualTitles,
  visualModelsState = 'loading',
  onRetryVisualModels,
  territorialComposerEnabled = false,
  territorialCatalog = null,
  territorialComposerState = 'disabled',
  territorialComposerError = '',
  onRetryTerritorialComposer,
  masterConfigs = [],
  masterControl = {},
  poolCounts = {},
  selectedFile,
  setSelectedFile,
}) {
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [submitSucceeded, setSubmitSucceeded] = useState(false)
  const [sourceLocked, setSourceLocked] = useState(Boolean(originBacklog))
  const [automaticPreparation, setAutomaticPreparation] = useState({ status: 'idle', error: '' })
  const articleIdRef = useRef(articleId)
  const sourceImageRef = useRef('')
  const revisionNumberRef = useRef(null)
  const preparedRef = useRef(false)
  const preparationPromiseRef = useRef(null)
  const autoPrepareStartedRef = useRef(false)
  const requests = useRef({})

  useEffect(() => {
    if (!articleId) return
    let active = true
    getEditorialArticleForEdit(supabase, articleId)
      .then(row => {
        if (!active) return
        articleIdRef.current = row.id
        revisionNumberRef.current = row.revision_number
        sourceImageRef.current = row.source_image_url || row.original_source_image_url || ''
        const hasPreparedDraft = Number(row.revision_number || 0) > 0
        if (preparedRef.current && !hasPreparedDraft) return
        preparedRef.current = hasPreparedDraft
        setSourceLocked(Boolean(originBacklog || row.ai_source_captured || hasPreparedDraft))
        setFormData(previous => ({
          ...previous,
          source_mode: row.origin_type === 'text' ? 'manual' : 'link',
          url_original: row.origin_reference || originBacklog?.url_original || previous.url_original,
          source_titulo: row.original_source_title || originBacklog?.titulo || previous.source_titulo || '',
          source_conteudo: row.original_source_body || previous.source_conteudo || '',
          titulo: hasPreparedDraft ? row.headline : (originBacklog?.titulo || row.original_source_title || previous.titulo),
          conteudo: hasPreparedDraft ? row.body : (row.original_source_body || previous.conteudo),
          caption: row.caption || previous.caption || '',
          context_tag: row.context_tag || previous.context_tag || '',
          category: row.category || previous.category || '',
          location: row.location || previous.location,
          image_url: row.source_image_url || row.original_source_image_url || previous.image_url,
          content_type: row.content_type || previous.content_type,
          visual_model: row.visual_model || previous.visual_model,
          visual_title_id: row.visual_title_id || previous.visual_title_id,
          region_id: row.region_id || previous.region_id,
          city_id: row.city_id || previous.city_id,
          manual_slots: row.manual_slots || previous.manual_slots,
        }))
      })
      .catch(error => toast.error(messageForRpcError(error?.code || error?.message).description))
    return () => { active = false }
  }, [articleId, originBacklog, setFormData])

  function applyPreparedArticle(prepared, fallback = {}) {
    preparedRef.current = true
    revisionNumberRef.current = prepared.revision_number
    setSourceLocked(true)
    sourceImageRef.current = prepared.source_image_url || prepared.original_source_image_url || fallback.sourceImageUrl || ''
    const sourceTitle = prepared.original_source_title || fallback.sourceTitle || ''
    const sourceBody = prepared.original_source_body || fallback.sourceBody || ''
    setFormData(previous => ({
      ...previous,
      source_titulo: sourceTitle || previous.source_titulo || '',
      source_conteudo: sourceBody || previous.source_conteudo || '',
      titulo: prepared.headline || '',
      conteudo: prepared.body || '',
      caption: prepared.caption || '',
      context_tag: prepared.context_tag || '',
      category: prepared.category || '',
      location: prepared.location || { city: null, region: null, state: null },
      image_url: prepared.source_image_url || prepared.original_source_image_url || fallback.sourceImageUrl || previous.image_url,
    }))
  }

  async function waitForPreparedDraft(targetArticleId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = await getEditorialArticleForEdit(supabase, targetArticleId)
      if (Number(current.revision_number || 0) > 0) return current
      await new Promise(resolve => window.setTimeout(resolve, 1000))
    }
    throw Object.assign(new Error('EDITORIAL_AI_TIMEOUT'), { code: 'EDITORIAL_AI_TIMEOUT' })
  }

  async function prepareForReview() {
    if (preparedRef.current) return
    if (preparationPromiseRef.current) return preparationPromiseRef.current
    const preparation = (async () => {
      setErrors({})
      setAutomaticPreparation({ status: 'preparing', error: '' })
      const aiEnabled = await getEditorialAiDraftStatus(supabase)
      if (!aiEnabled) throw new Error('EDITORIAL_AI_DISABLED')

      if (originBacklog?.collected_news_id) {
        const current = await getEditorialArticleForEdit(supabase, articleIdRef.current)
        if (Number(current.revision_number || 0) > 0) {
          applyPreparedArticle(current)
          setAutomaticPreparation({ status: 'ready', error: '' })
          return
        }

        let sourceTitle = (originBacklog.source_title || originBacklog.titulo || '').trim()
        let sourceBody = (originBacklog.source_body || '').trim()
        const collectedImageUrl = (originBacklog.source_image_url || '').trim()
        const capturedImageUrl = (current.original_source_image_url || '').trim()
        let sourceImageUrl = /^https:\/\//i.test(collectedImageUrl) ? collectedImageUrl : ''
        const shouldScrape = originBacklog.source_requires_scrape
          || (!/^https:\/\//i.test(capturedImageUrl) && !sourceImageUrl)
        if (shouldScrape) {
          let scraped
          try {
            scraped = await scrapeArticleSource(supabase, originBacklog.source_url || originBacklog.url_original)
          } catch (error) {
            throw Object.assign(error, { code: 'SOURCE_SCRAPE_FAILED' })
          }
          if (originBacklog.source_requires_scrape) {
            sourceTitle = (scraped.title || sourceTitle).trim()
            sourceBody = (scraped.content || '').trim()
          }
          sourceImageUrl = (sourceImageUrl || scraped.image_url || '').trim()
        }
        if (!current.ai_source_captured) {
          await captureCollectedNewsArticleSource(supabase, {
            articleId: articleIdRef.current,
            collectedNewsId: originBacklog.collected_news_id,
            scrapedTitle: originBacklog.source_requires_scrape ? sourceTitle : null,
            scrapedBody: originBacklog.source_requires_scrape ? sourceBody : null,
            scrapedImageUrl: shouldScrape ? sourceImageUrl : null,
            requestId: requestId(requests, 'source'),
          })
          resetRequestId(requests, 'source')
        }

        // Image preparation is independent from the LLM. Make it available to
        // the operator and to the later production-intent/Placid path even if
        // the AI provider fails and the user needs to retry the text draft.
        sourceImageRef.current = sourceImageUrl
          || (/^https:\/\//i.test(capturedImageUrl) ? capturedImageUrl : '')
        if (sourceImageRef.current) {
          setFormData(previous => ({ ...previous, image_url: sourceImageRef.current }))
        }

        try {
          await prepareEditorialAiDraft(supabase, {
            articleId: articleIdRef.current,
            requestId: requestId(requests, 'aiDraft'),
          })
          resetRequestId(requests, 'aiDraft')
        } catch (error) {
          const code = String(error?.code || error?.message || '')
          resetRequestId(requests, 'aiDraft')
          if (!code.includes('EDITORIAL_AI_DRAFT_IN_PROGRESS')) throw error
        }
        const prepared = await waitForPreparedDraft(articleIdRef.current)
        applyPreparedArticle(prepared, { sourceTitle, sourceBody, sourceImageUrl })
        setAutomaticPreparation({ status: 'ready', error: '' })
        toast.success('Matéria preparada para sua revisão.')
        return
      }

      let sourceTitle = (formData.titulo || originBacklog?.titulo || '').trim()
      let sourceBody = (formData.conteudo || '').trim()
      let sourceImageUrl = (formData.image_url || '').trim()
      const isLink = formData.source_mode === 'link'

      if (isLink) {
        const scraped = await scrapeArticleSource(supabase, formData.url_original)
        sourceTitle = (scraped.title || sourceTitle).trim()
        sourceBody = (scraped.content || '').trim()
        sourceImageUrl = (sourceImageUrl || scraped.image_url || '').trim()
      }
      if (sourceTitle.length < 8) throw Object.assign(new Error('SOURCE_TITLE_REQUIRED'), { code: 'SOURCE_TITLE_REQUIRED' })
      if (sourceBody.length < 20) throw Object.assign(new Error('SOURCE_BODY_REQUIRED'), { code: 'SOURCE_BODY_REQUIRED' })

      if (selectedFile) {
        sourceImageUrl = await uploadEditorialSourceImage(supabase, {
          file: selectedFile,
          folder: 'editorial_uploads',
        })
      }
      sourceImageRef.current = sourceImageUrl

      if (!articleIdRef.current) {
        const created = await startEditorialArticleDirect(supabase, {
          originType: isLink ? 'link' : 'text',
          originReference: isLink ? formData.url_original.trim() : null,
          requestId: requestId(requests, 'create'),
        })
        articleIdRef.current = created.id
        resetRequestId(requests, 'create')
      }

      const current = await getEditorialArticleForEdit(supabase, articleIdRef.current)
      if (!current.ai_source_captured) {
        await captureEditorialArticleSource(supabase, {
          articleId: articleIdRef.current,
          sourceType: isLink ? 'link' : 'text',
          sourceUrl: isLink ? formData.url_original.trim() : null,
          sourceTitle,
          sourceBody,
          sourceImageUrl: sourceImageUrl || null,
          requestId: requestId(requests, 'source'),
        })
        resetRequestId(requests, 'source')
      }

      await prepareEditorialAiDraft(supabase, {
        articleId: articleIdRef.current,
        requestId: requestId(requests, 'aiDraft'),
      })
      resetRequestId(requests, 'aiDraft')

      const prepared = await getEditorialArticleForEdit(supabase, articleIdRef.current)
      applyPreparedArticle(prepared, { sourceTitle, sourceBody, sourceImageUrl })
      setAutomaticPreparation({ status: 'ready', error: '' })
      toast.success('Matéria preparada para sua revisão.')
    })()
    preparationPromiseRef.current = preparation
    try {
      return await preparation
    } catch (error) {
      resetRequestId(requests, 'aiDraft')
      const friendly = userFacingError(error)
      setAutomaticPreparation({ status: 'error', error: friendly.userMessage })
      throw friendly
    } finally {
      preparationPromiseRef.current = null
    }
  }

  useEffect(() => {
    if (!articleId || !originBacklog?.auto_prepare || autoPrepareStartedRef.current) return
    autoPrepareStartedRef.current = true
    void prepareForReview().catch(() => {})
    // The one-shot is keyed by the wizard's articleId; callbacks intentionally
    // remain outside the dependency list so form edits cannot start a second run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId, originBacklog?.auto_prepare])

  async function submit(e) {
    e.preventDefault()
    if (isSubmitting || !articleIdRef.current || !preparedRef.current) return

    const canonicalForm = canonicalFormFromWizard(formData, sourceImageRef.current)
    const contentErrors = validateContentStep(canonicalForm, { requireAiFields: true })
    const intentErrors = validateProductionIntentStep(canonicalForm, {
      territorialComposerEnabled,
      territorialCatalog,
      masterConfigs,
      masterControl,
      poolCounts,
    })
    const wizardErrors = {
      ...(contentErrors.headline ? { titulo: contentErrors.headline } : {}),
      ...(contentErrors.body ? { conteudo: contentErrors.body } : {}),
      ...(contentErrors.caption ? { caption: contentErrors.caption } : {}),
      ...intentErrors,
    }
    if (Object.keys(contentErrors).length || Object.keys(intentErrors).length) {
      setErrors(wizardErrors)
      toast.error('Revise os campos destacados.')
      return
    }

    setErrors({})
    setIsSubmitting(true)
    try {
      let article = await getEditorialArticleForEdit(supabase, articleIdRef.current)
      const finalizedContentChanged = article.status === 'content_final' && (
        (article.headline || '').trim() !== (canonicalForm.headline || '').trim()
        || (article.body || '').trim() !== (canonicalForm.body || '').trim()
        || (article.caption || '').trim() !== (canonicalForm.caption || '').trim()
      )
      if (finalizedContentChanged) {
        await requestEditorialArticleChanges(supabase, {
          articleId: article.id,
          reason: 'Ajuste do autor antes do envio para render.',
          requestId: requestId(requests, 'reopenAfterFailure'),
        })
        resetRequestId(requests, 'reopenAfterFailure')
        article = await getEditorialArticleForEdit(supabase, article.id)
      }
      if (article.status === 'draft' || article.status === 'editing' || article.status === 'changes_requested') {
        await saveEditorialArticleProductionIntent(supabase, buildProductionIntentPayload(canonicalForm, {
          articleId: article.id,
          requestId: requestId(requests, 'productionIntent'),
          territorialComposerEnabled,
        }))
        resetRequestId(requests, 'productionIntent')

        await finalizeEditorialArticle(supabase, buildFinalizePayload(canonicalForm, {
          articleId: article.id,
          requestId: requestId(requests, 'finalize'),
          expectedRevisionNumber: article.revision_number,
        }))
        resetRequestId(requests, 'finalize')
        article = await getEditorialArticleForEdit(supabase, article.id)
      }

      if (article.status === 'content_final') {
        await approveEditorialArticleForRender(supabase, {
          articleId: article.id,
          expectedRevisionNumber: article.revision_number,
          requestId: requestId(requests, 'approve'),
        })
        resetRequestId(requests, 'approve')
        article = await getEditorialArticleForEdit(supabase, article.id)
      }

      let dispatchResult = null
      if (article.status === 'ready_for_render' || article.status === 'dispatched') {
        dispatchResult = await dispatchEditorialArticleRender(supabase, article.id)
        article = await getEditorialArticleForEdit(supabase, article.id)
      }

      const candidateNewsId = dispatchResult?.candidate_news_id || article.candidate_news_id || null
      if (article.status !== 'dispatched' || !candidateNewsId) {
        throw Object.assign(new Error('DISPATCH_FAILED'), { code: 'DISPATCH_FAILED' })
      }

      setSubmitSucceeded(true)
      toast.success('Aprovada e enviada para renderização.')
      onComplete?.({
        articleId: article.id,
        candidateNewsId,
      })
    } catch (error) {
      toast.error(messageForRpcError(error?.code || error?.message).description)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function saveHumanDraft() {
    if (isSavingDraft || !articleIdRef.current || !preparedRef.current) return

    const canonicalForm = canonicalFormFromWizard(formData, sourceImageRef.current)
    const contentErrors = validateContentStep(canonicalForm, { requireAiFields: true })
    if (Object.keys(contentErrors).length) {
      setErrors({
        ...(contentErrors.headline ? { titulo: contentErrors.headline } : {}),
        ...(contentErrors.body ? { conteudo: contentErrors.body } : {}),
        ...(contentErrors.caption ? { caption: contentErrors.caption } : {}),
      })
      toast.error('Revise os campos editoriais destacados.')
      return
    }

    setErrors({})
    setIsSavingDraft(true)
    try {
      await saveEditorialArticleDraft(supabase, buildDraftPayload(canonicalForm, {
        articleId: articleIdRef.current,
        requestId: requestId(requests, 'humanDraft'),
        expectedRevisionNumber: revisionNumberRef.current,
      }))
      resetRequestId(requests, 'humanDraft')
      const saved = await getEditorialArticleForEdit(supabase, articleIdRef.current)
      applyPreparedArticle(saved)
      toast.success('Rascunho salvo.')
    } catch (error) {
      resetRequestId(requests, 'humanDraft')
      toast.error(messageForRpcError(error?.code || error?.message).description)
    } finally {
      setIsSavingDraft(false)
    }
  }

  function createAnother() {
    articleIdRef.current = null
    sourceImageRef.current = ''
    revisionNumberRef.current = null
    preparedRef.current = false
    requests.current = {}
    setSourceLocked(false)
    setAutomaticPreparation({ status: 'idle', error: '' })
    autoPrepareStartedRef.current = false
    setSubmitSucceeded(false)
    setErrors({})
    onCreateAnother?.()
  }

  return (
    <ArticleWizard
      formData={formData}
      setFormData={value => {
        setErrors({})
        setFormData(value)
      }}
      errors={errors}
      onSubmit={submit}
      isSubmitting={isSubmitting}
      onCancel={onCancel}
      onBeforeReview={prepareForReview}
      preparationStatus={automaticPreparation.status}
      automaticPreparationError={automaticPreparation.error}
      onRetryPreparation={() => {
        autoPrepareStartedRef.current = true
        void prepareForReview().catch(() => {})
      }}
      onSaveDraft={saveHumanDraft}
      isSavingDraft={isSavingDraft}
      sourceLocked={sourceLocked}
      fixedFiveSteps
      showEditorialDraft
      submitLabel="Aprovar e gerar arte"
      availableVisualModels={availableVisualModels}
      visualModelOptions={visualModelOptions}
      availableFormats={availableFormats}
      visualTitleGroups={visualTitleGroups}
      visualTitlesLoading={visualTitlesLoading}
      visualTitlesError={visualTitlesError}
      onRetryVisualTitles={onRetryVisualTitles}
      visualModelsState={visualModelsState}
      onRetryVisualModels={onRetryVisualModels}
      territorialComposerEnabled={territorialComposerEnabled}
      territorialCatalog={territorialCatalog}
      territorialComposerState={territorialComposerState}
      territorialComposerError={territorialComposerError}
      onRetryTerritorialComposer={onRetryTerritorialComposer}
      selectedFile={selectedFile}
      setSelectedFile={setSelectedFile}
      submitSucceeded={submitSucceeded}
      onCreateAnother={createAnother}
    />
  )
}
