// Pure merge of the legacy news-work list (ap.list_my_news_work) and the
// canonical editorial-articles list (ap.list_my_editorial_articles) into one
// deduplicated set. Extracted from MyNewsWork.jsx's own inline logic so the
// dedup rule -- an editorial article's news_backlog_id already covers the
// same pauta, so the matching legacy row is dropped rather than shown twice
// -- is testable on its own (2B.2.3 sections 11/33).
export function normalizeLegacyWorkItem(item) {
  return {
    ...item,
    origin: 'legacy',
    uniqueId: `legacy-${item.id}`,
  }
}

export function normalizeEditorialWorkItem(item) {
  return {
    ...item,
    origin: 'editorial',
    uniqueId: `editorial-${item.article_id || item.id}`,
    titulo: item.headline || 'Matéria sem título',
    adopted_at: item.created_at,
    production_started_at: item.created_at,
    production_completed_at: item.finalized_at || item.first_finalized_at,
  }
}

export function mergeLegacyAndEditorialWork(legacyItems, editorialItems) {
  const editorialBacklogIds = new Set(
    (editorialItems || []).map(item => item.news_backlog_id).filter(Boolean),
  )
  const normalizedLegacy = (legacyItems || [])
    .filter(item => !editorialBacklogIds.has(item.id))
    .map(normalizeLegacyWorkItem)
  const normalizedEditorial = (editorialItems || []).map(normalizeEditorialWorkItem)
  return [...normalizedLegacy, ...normalizedEditorial]
}
