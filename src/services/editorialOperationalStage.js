// UI-only read model mapping ap.editorial_articles.status to an operational
// stage label (2B.2.3 section 22-23). Never persisted -- purely derived, so
// the database keeps one status vocabulary and the UI is free to relabel it.
// Deliberately does not fold in P0/render sub-states (pending_render/
// pending_review/approved for a dispatched candidate): that finer-grained
// breakdown is presented as an illustrative example in the request, not a
// hard requirement, and doing it here would mean querying candidate_news
// status for every editorial row just to render a label -- skipped for this
// delivery, documented rather than silently omitted.
export const OPERATIONAL_STAGES = Object.freeze({
  IN_PRODUCTION: 'in_production',
  NEEDS_CORRECTION: 'needs_correction',
  IN_REVIEW: 'in_review',
  PREPARING_RENDER: 'preparing_render',
  COMPLETED: 'completed',
})

const STAGE_BY_STATUS = Object.freeze({
  draft: { key: OPERATIONAL_STAGES.IN_PRODUCTION, label: 'Em produção' },
  editing: { key: OPERATIONAL_STAGES.IN_PRODUCTION, label: 'Em produção' },
  changes_requested: { key: OPERATIONAL_STAGES.NEEDS_CORRECTION, label: 'Precisa corrigir' },
  content_final: { key: OPERATIONAL_STAGES.IN_REVIEW, label: 'Em revisão' },
  ready_for_render: { key: OPERATIONAL_STAGES.PREPARING_RENDER, label: 'Preparando render' },
  dispatched: { key: OPERATIONAL_STAGES.COMPLETED, label: 'Concluído' },
  abandoned: { key: OPERATIONAL_STAGES.COMPLETED, label: 'Concluído' },
})

const FALLBACK_STAGE = Object.freeze({ key: OPERATIONAL_STAGES.IN_PRODUCTION, label: 'Em produção' })

export function operationalStageForEditorialStatus(status) {
  return STAGE_BY_STATUS[status] || FALLBACK_STAGE
}
