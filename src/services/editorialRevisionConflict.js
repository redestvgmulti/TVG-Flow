export function isEditorialRevisionConflict(error) {
  return error?.code === 'EDITORIAL_REVISION_CONFLICT'
    || error?.message === 'EDITORIAL_REVISION_CONFLICT'
}

export function canKeepLocalEditorialText(article) {
  return ['draft', 'editing', 'changes_requested'].includes(article?.status)
}

export function assertEditorialRevision(article, expectedRevisionNumber) {
  // A dispatched article can be read again to recover a failed handoff. It
  // cannot accept content writes. Editable/final content must match the
  // revision the author actually reviewed, even when submit refreshes it.
  if (['ready_for_render', 'dispatched'].includes(article.status)) return
  if (article.revision_number !== expectedRevisionNumber) {
    throw Object.assign(new Error('EDITORIAL_REVISION_CONFLICT'), {
      code: 'EDITORIAL_REVISION_CONFLICT',
    })
  }
}
