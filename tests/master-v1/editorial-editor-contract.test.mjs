import test from 'node:test'
import assert from 'node:assert/strict'

import {
  EDITOR_MODES,
  allowedActionsForMode,
  editorModeForStatus,
  isArticleReadOnly,
  messageForRpcError,
} from '../../src/services/editorialArticleContract.js'

test('editorModeForStatus maps every known status to its UI mode', () => {
  assert.equal(editorModeForStatus({ hasArticle: false, status: null }), EDITOR_MODES.CREATE)
  assert.equal(editorModeForStatus({ hasArticle: true, status: 'draft' }), EDITOR_MODES.EDIT)
  assert.equal(editorModeForStatus({ hasArticle: true, status: 'editing' }), EDITOR_MODES.EDIT)
  assert.equal(editorModeForStatus({ hasArticle: true, status: 'changes_requested' }), EDITOR_MODES.CHANGES_REQUESTED)
  assert.equal(editorModeForStatus({ hasArticle: true, status: 'content_final' }), EDITOR_MODES.REVIEW_PREVIEW)
  assert.equal(editorModeForStatus({ hasArticle: true, status: 'ready_for_render' }), EDITOR_MODES.READ_ONLY)
  assert.equal(editorModeForStatus({ hasArticle: true, status: 'dispatched' }), EDITOR_MODES.READ_ONLY)
  assert.equal(editorModeForStatus({ hasArticle: true, status: 'abandoned' }), EDITOR_MODES.READ_ONLY)
})

test('isArticleReadOnly matches exactly the frozen statuses', () => {
  assert.equal(isArticleReadOnly('ready_for_render'), true)
  assert.equal(isArticleReadOnly('dispatched'), true)
  assert.equal(isArticleReadOnly('abandoned'), true)
  assert.equal(isArticleReadOnly('draft'), false)
  assert.equal(isArticleReadOnly('content_final'), false)
})

test('allowedActionsForMode: staff author can edit/save/submit in edit and changes_requested, never approve', () => {
  const edit = allowedActionsForMode(EDITOR_MODES.EDIT, { isResponsible: true, canReview: false })
  assert.equal(edit.canSave, true)
  assert.equal(edit.canSubmitForReview, true)
  assert.equal(edit.canApprove, false)
  assert.equal(edit.canRequestChanges, false)

  const changes = allowedActionsForMode(EDITOR_MODES.CHANGES_REQUESTED, { isResponsible: true, canReview: false })
  assert.equal(changes.canSave, true)
  assert.equal(changes.canSubmitForReview, true)
})

test('allowedActionsForMode: an unrelated staff member (not responsible, no review rights) can do nothing', () => {
  const edit = allowedActionsForMode(EDITOR_MODES.EDIT, { isResponsible: false, canReview: false })
  assert.equal(edit.canSave, false)
  assert.equal(edit.canSubmitForReview, false)
})

test('allowedActionsForMode: admin can edit any article in edit mode, and can approve/return in review_preview', () => {
  const edit = allowedActionsForMode(EDITOR_MODES.EDIT, { isResponsible: false, canReview: true })
  assert.equal(edit.canSave, true)

  const review = allowedActionsForMode(EDITOR_MODES.REVIEW_PREVIEW, { isResponsible: false, canReview: true })
  assert.equal(review.canEditContent, false)
  assert.equal(review.canApprove, true)
  assert.equal(review.canRequestChanges, true)
})

test('allowedActionsForMode: read_only mode never allows any action, even for admin', () => {
  const readOnly = allowedActionsForMode(EDITOR_MODES.READ_ONLY, { isResponsible: true, canReview: true })
  assert.deepEqual(readOnly, {
    canEditContent: false,
    canEditProductionIntent: false,
    canSave: false,
    canSubmitForReview: false,
    canApprove: false,
    canRequestChanges: false,
  })
})

test('messageForRpcError maps known RPC error codes and falls back for unknown ones', () => {
  assert.equal(messageForRpcError('EDITORIAL_REVISION_CONFLICT').description.includes('outra sessão'), true)
  assert.equal(messageForRpcError('ARTICLE_NOT_FOUND').title, 'Matéria não encontrada')
  assert.equal(messageForRpcError('FORBIDDEN').title, 'Sem permissão')
  const fallback = messageForRpcError('SOME_UNKNOWN_CODE_NEVER_SEEN')
  assert.equal(fallback.title, 'Algo deu errado')
})
