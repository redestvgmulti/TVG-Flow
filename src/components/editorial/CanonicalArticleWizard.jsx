import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import ArticleWizard from './ArticleWizard'
import { supabase } from '../../services/supabase'
import { messageForRpcError } from '../../services/editorialArticleContract'
import {
  buildFinalizePayload,
  buildProductionIntentPayload,
  validateContentStep,
  validateProductionIntentStep,
} from '../../services/editorialArticleForm'
import {
  approveEditorialArticleForRender,
  captureEditorialArticleSource,
  dispatchEditorialArticleRender,
  finalizeEditorialArticle,
  getEditorialAiDraftStatus,
  getEditorialArticleForEdit,
  prepareEditorialAiDraft,
  requestEditorialArticleChanges,
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
  const [submitSucceeded, setSubmitSucceeded] = useState(false)
  const [sourceLocked, setSourceLocked] = useState(false)
  const articleIdRef = useRef(articleId)
  const sourceImageRef = useRef('')
  const preparedRef = useRef(false)
  const requests = useRef({})

  useEffect(() => {
    if (!articleId) return
    let active = true
    getEditorialArticleForEdit(supabase, articleId)
      .then(row => {
        if (!active) return
        articleIdRef.current = row.id
        sourceImageRef.current = row.source_image_url || row.original_source_image_url || ''
        const hasPreparedDraft = Number(row.revision_number || 0) > 0
        preparedRef.current = hasPreparedDraft
        setSourceLocked(Boolean(row.ai_source_captured || hasPreparedDraft))
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

  async function prepareForReview() {
    if (preparedRef.current) return
    setErrors({})
    try {
      const aiEnabled = await getEditorialAiDraftStatus(supabase)
      if (!aiEnabled) throw new Error('EDITORIAL_AI_DISABLED')

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
      preparedRef.current = true
      setSourceLocked(true)
      setFormData(previous => ({
        ...previous,
        source_titulo: sourceTitle,
        source_conteudo: sourceBody,
        titulo: prepared.headline || '',
        conteudo: prepared.body || '',
        caption: prepared.caption || '',
        context_tag: prepared.context_tag || '',
        category: prepared.category || '',
        location: prepared.location || { city: null, region: null, state: null },
        image_url: sourceImageUrl || previous.image_url,
      }))
      toast.success('Matéria preparada para sua revisão.')
    } catch (error) {
      throw userFacingError(error)
    }
  }

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

  function createAnother() {
    articleIdRef.current = null
    sourceImageRef.current = ''
    preparedRef.current = false
    requests.current = {}
    setSourceLocked(false)
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
