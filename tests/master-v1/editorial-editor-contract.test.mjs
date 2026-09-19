import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  CREATION_MODES,
  EDITOR_MODES,
  allowedActionsForMode,
  canRetryDispatch,
  dispatchButtonLabel,
  editorModeForStatus,
  isArticleReadOnly,
  messageForRpcError,
  resolveCreationMode,
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

test('messageForRpcError covers the backlog-adoption error codes surfaced by 2B.2.3 wiring', () => {
  assert.equal(messageForRpcError('BACKLOG_NOT_FOUND').title, 'Pauta não encontrada')
  assert.equal(messageForRpcError('BACKLOG_NOT_ADOPTED').title, 'Pauta não adotada')
  assert.equal(messageForRpcError('BACKLOG_NOT_OWNED').title, 'Pauta de outra pessoa')
  assert.ok(messageForRpcError('BACKLOG_LEGACY_CANDIDATE_LINKED').description)
  assert.ok(messageForRpcError('DISPATCH_FAILED').description.includes('Tente novamente'))
})

test('resolveCreationMode is the single decision both AutoPublisher.jsx and EmployeeMode.jsx branch on', () => {
  assert.equal(resolveCreationMode(true), CREATION_MODES.CANONICAL)
  assert.equal(resolveCreationMode(false), CREATION_MODES.LEGACY)
  assert.equal(resolveCreationMode(undefined), CREATION_MODES.PENDING)
  assert.equal(resolveCreationMode(false, { loading: true }), CREATION_MODES.PENDING)
  assert.equal(resolveCreationMode(true, { loading: true }), CREATION_MODES.PENDING)
  assert.equal(resolveCreationMode(false, { error: true }), CREATION_MODES.PENDING)
})

test('creation hosts never route an unresolved feature flag into the legacy editor', async () => {
  const [autoPublisher, employeeMode, hook] = await Promise.all([
    readFile(new URL('../../src/pages/admin/AutoPublisher.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/pages/admin/EmployeeMode.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/hooks/useEditorialWorkflowFlag.js', import.meta.url), 'utf8'),
  ])

  for (const host of [autoPublisher, employeeMode]) {
    assert.match(host, /resolveCreationMode\(editorialFlag\.enabled, editorialFlag\)/)
    assert.match(host, /creationMode === CREATION_MODES\.PENDING/)
  }
  assert.match(autoPublisher, /disabled=\{editorialFlag\.loading\}/)
  assert.match(hook, /useState\(null\)/)
  assert.match(hook, /setError\(true\)/)
})

test('canRetryDispatch/dispatchButtonLabel: the manual dispatch action is offered exactly while ready_for_render, worded by whether a prior attempt failed', () => {
  assert.equal(canRetryDispatch('ready_for_render'), true)
  assert.equal(canRetryDispatch('dispatched'), false)
  assert.equal(canRetryDispatch('content_final'), false)
  assert.equal(dispatchButtonLabel(false), 'Enviar para render')
  assert.equal(dispatchButtonLabel(true), 'Tentar enviar para render novamente')
})
