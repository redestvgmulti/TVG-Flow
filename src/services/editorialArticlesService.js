// I/O layer for the canonical editorial editor (2B.2.2). Every RPC name and
// parameter here was read directly from the 2B.1/2B.2.1 migration files, not
// assumed. Never resolves success without confirming the RPC actually
// returned the row it claims to have written (ap-2b2 finding: silent-zero-row
// "successes" from earlier legacy code paths).

export class EditorialArticleError extends Error {
  constructor(code, cause) {
    super(code)
    this.name = 'EditorialArticleError'
    this.code = code
    this.cause = cause
  }
}

async function callArticleRpc(supabase, fn, params) {
  const { data, error } = await supabase.schema('ap').rpc(fn, params)
  if (error) throw new EditorialArticleError(error.message || 'UNKNOWN_ERROR', error)
  if (!data) throw new EditorialArticleError('UNEXPECTED_EMPTY_RESULT')
  return data
}

export async function startEditorialArticleDirect(supabase, { originType, originReference, requestId }) {
  return callArticleRpc(supabase, 'start_editorial_article_direct', {
    p_origin_type: originType,
    p_origin_reference: originReference,
    p_request_id: requestId,
  })
}

export async function getEditorialArticleForEdit(supabase, articleId) {
  const { data, error } = await supabase.schema('ap').rpc('get_editorial_article_for_edit', {
    p_article_id: articleId,
  })
  if (error) throw new EditorialArticleError(error.message || 'UNKNOWN_ERROR', error)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new EditorialArticleError('ARTICLE_NOT_FOUND')
  return row
}

export async function saveEditorialArticleDraft(supabase, { articleId, headline, body, requestId, expectedRevisionNumber = null }) {
  return callArticleRpc(supabase, 'save_editorial_article_draft', {
    p_article_id: articleId,
    p_headline: headline,
    p_body: body,
    p_request_id: requestId,
    p_expected_revision_number: expectedRevisionNumber,
  })
}

export async function saveEditorialArticleProductionIntent(supabase, {
  articleId, productionInputType, contentType, visualModel, visualTitleId,
  regionId, cityId, manualSlots, sourceImageUrl, requestId,
}) {
  return callArticleRpc(supabase, 'save_editorial_article_production_intent', {
    p_article_id: articleId,
    p_production_input_type: productionInputType,
    p_content_type: contentType,
    p_visual_model: visualModel,
    p_visual_title_id: visualTitleId,
    p_region_id: regionId,
    p_city_id: cityId,
    p_manual_slots: manualSlots,
    p_source_image_url: sourceImageUrl,
    p_request_id: requestId,
  })
}

export async function finalizeEditorialArticle(supabase, { articleId, headline, body, requestId, expectedRevisionNumber = null }) {
  return callArticleRpc(supabase, 'finalize_editorial_article', {
    p_article_id: articleId,
    p_headline: headline,
    p_body: body,
    p_request_id: requestId,
    p_expected_revision_number: expectedRevisionNumber,
  })
}

export async function requestEditorialArticleChanges(supabase, { articleId, reason, requestId }) {
  return callArticleRpc(supabase, 'request_editorial_article_changes', {
    p_article_id: articleId,
    p_reason: reason,
    p_request_id: requestId,
  })
}

export async function approveEditorialArticleForRender(supabase, { articleId, expectedRevisionNumber, requestId }) {
  return callArticleRpc(supabase, 'approve_editorial_article_for_render', {
    p_article_id: articleId,
    p_expected_revision_number: expectedRevisionNumber,
    p_request_id: requestId,
  })
}

export async function scrapeArticleSource(supabase, url) {
  const { data, error } = await supabase.functions.invoke('ap-link-scraper', { body: { url } })
  if (error) throw new EditorialArticleError('SOURCE_SCRAPE_FAILED', error)
  if (!data) throw new EditorialArticleError('UNEXPECTED_EMPTY_RESULT')
  return data
}

export async function uploadEditorialSourceImage(supabase, { file, folder }) {
  const extension = file.name.split('.').pop()
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${extension}`
  const filePath = `${folder}/${fileName}`

  const { error: uploadError } = await supabase.storage.from('ap-images').upload(filePath, file)
  if (uploadError) throw new EditorialArticleError('IMAGE_UPLOAD_FAILED', uploadError)

  const { data } = supabase.storage.from('ap-images').getPublicUrl(filePath)
  if (!data?.publicUrl) throw new EditorialArticleError('UNEXPECTED_EMPTY_RESULT')
  return data.publicUrl
}
