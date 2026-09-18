import test from 'node:test'
import assert from 'node:assert/strict'

import {
  editorialEditorReducer,
  initialEditorialEditorState,
} from '../../src/components/editorial/canonicalEditor/editorialEditorReducer.js'

function article(overrides = {}) {
  return {
    id: 'a1', status: 'draft', headline: 'Título', body: 'Corpo',
    content_type: '', visual_model: '', visual_title_id: null,
    region_id: null, city_id: null, manual_slots: [], source_image_url: '',
    origin_type: 'text', origin_reference: '', production_input_type: 'text',
    revision_number: 1, candidate_news_id: null, updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

test('initial state starts in create mode with an empty form', () => {
  const state = initialEditorialEditorState('link')
  assert.equal(state.mode, 'create')
  assert.equal(state.articleId, null)
  assert.equal(state.form.origin_type, 'link')
})

test('LOAD_SUCCESS adopts the article, derives mode from status, and clears dirty flags', () => {
  const state = editorialEditorReducer(
    initialEditorialEditorState(),
    { type: 'LOAD_SUCCESS', article: article({ status: 'changes_requested' }) },
  )
  assert.equal(state.mode, 'changes_requested')
  assert.equal(state.articleId, 'a1')
  assert.equal(state.revisionNumber, 1)
  assert.deepEqual(state.dirty, { content: false, productionIntent: false })
})

test('LOAD_ERROR surfaces the error without touching any prior form state', () => {
  const loaded = editorialEditorReducer(initialEditorialEditorState(), { type: 'LOAD_SUCCESS', article: article() })
  const state = editorialEditorReducer(loaded, { type: 'LOAD_ERROR', error: { code: 'ARTICLE_NOT_FOUND' } })
  assert.equal(state.status, 'error')
  assert.equal(state.error.code, 'ARTICLE_NOT_FOUND')
  assert.equal(state.form.headline, 'Título', 'form is untouched by a load error')
})

test('FIELD_CHANGE marks only the content flag dirty when headline/body change', () => {
  const loaded = editorialEditorReducer(initialEditorialEditorState(), { type: 'LOAD_SUCCESS', article: article() })
  const state = editorialEditorReducer(loaded, {
    type: 'FIELD_CHANGE',
    updater: previous => ({ ...previous, headline: 'Novo título' }),
  })
  assert.deepEqual(state.dirty, { content: true, productionIntent: false })
})

test('FIELD_CHANGE marks only the productionIntent flag dirty when a format/territory field changes', () => {
  const loaded = editorialEditorReducer(initialEditorialEditorState(), { type: 'LOAD_SUCCESS', article: article() })
  const state = editorialEditorReducer(loaded, {
    type: 'FIELD_CHANGE',
    updater: previous => ({ ...previous, content_type: 'feed' }),
  })
  assert.deepEqual(state.dirty, { content: false, productionIntent: true })
})

test('FIELD_CHANGE supports a plain object updater (TerritorialComposerFields calls setFormData with an updater fn, VisualTitleCombobox may call it with a partial object)', () => {
  const loaded = editorialEditorReducer(initialEditorialEditorState(), { type: 'LOAD_SUCCESS', article: article() })
  const state = editorialEditorReducer(loaded, { type: 'FIELD_CHANGE', updater: { visual_title_id: 'vt1' } })
  assert.equal(state.form.visual_title_id, 'vt1')
  assert.equal(state.dirty.productionIntent, true)
})

test('ARTICLE_CREATED adopts the new article id but preserves the in-progress form/dirty state (the user\'s unsaved edits must survive creation)', () => {
  let state = editorialEditorReducer(initialEditorialEditorState('text'), {
    type: 'FIELD_CHANGE',
    updater: { headline: 'Rascunho ainda não salvo' },
  })
  assert.equal(state.dirty.content, true)
  state = editorialEditorReducer(state, {
    type: 'ARTICLE_CREATED',
    article: article({ id: 'brand-new', status: 'draft', headline: null, body: null, revision_number: 0 }),
  })
  assert.equal(state.articleId, 'brand-new')
  assert.equal(state.mode, 'edit')
  assert.equal(state.revisionNumber, 0)
  assert.equal(state.form.headline, 'Rascunho ainda não salvo', 'creation must not wipe the unsaved headline the user already typed')
  assert.equal(state.dirty.content, true, 'dirty flags survive so the immediately-following save actually persists the edit')
})

test('SAVE_SUCCESS clears dirty flags and advances the revision number', () => {
  let state = editorialEditorReducer(initialEditorialEditorState(), { type: 'LOAD_SUCCESS', article: article() })
  state = editorialEditorReducer(state, { type: 'FIELD_CHANGE', updater: { headline: 'Editado' } })
  state = editorialEditorReducer(state, { type: 'SAVE_START' })
  assert.equal(state.status, 'saving')
  state = editorialEditorReducer(state, { type: 'SAVE_SUCCESS', article: article({ headline: 'Editado', revision_number: 2 }) })
  assert.equal(state.status, 'idle')
  assert.equal(state.revisionNumber, 2)
  assert.deepEqual(state.dirty, { content: false, productionIntent: false })
  assert.equal(state.lastMessage, 'Rascunho salvo.')
})

test('SAVE_CONFLICT keeps the user\'s in-progress edits untouched and never overwrites the form', () => {
  let state = editorialEditorReducer(initialEditorialEditorState(), { type: 'LOAD_SUCCESS', article: article() })
  state = editorialEditorReducer(state, { type: 'FIELD_CHANGE', updater: { headline: 'Minha edição não salva' } })
  state = editorialEditorReducer(state, { type: 'SAVE_START' })
  state = editorialEditorReducer(state, { type: 'SAVE_CONFLICT', error: { code: 'EDITORIAL_REVISION_CONFLICT' } })
  assert.equal(state.conflict, true)
  assert.equal(state.form.headline, 'Minha edição não salva', 'a conflict must never discard local edits')
  assert.equal(state.status, 'idle')
})

test('a fresh LOAD_SUCCESS (the "Recarregar" action) replaces the form and clears the conflict flag', () => {
  let state = editorialEditorReducer(initialEditorialEditorState(), { type: 'LOAD_SUCCESS', article: article() })
  state = editorialEditorReducer(state, { type: 'FIELD_CHANGE', updater: { headline: 'Vai ser descartado' } })
  state = editorialEditorReducer(state, { type: 'SAVE_CONFLICT', error: { code: 'EDITORIAL_REVISION_CONFLICT' } })
  assert.equal(state.conflict, true)
  state = editorialEditorReducer(state, { type: 'LOAD_SUCCESS', article: article({ headline: 'Versão do servidor', revision_number: 5 }) })
  assert.equal(state.conflict, false)
  assert.equal(state.form.headline, 'Versão do servidor')
  assert.equal(state.revisionNumber, 5)
})

test('SUBMIT_SUCCESS transitions the mode to review_preview via the real article status', () => {
  let state = editorialEditorReducer(initialEditorialEditorState(), { type: 'LOAD_SUCCESS', article: article() })
  state = editorialEditorReducer(state, { type: 'SUBMIT_START' })
  assert.equal(state.status, 'submitting')
  state = editorialEditorReducer(state, { type: 'SUBMIT_SUCCESS', article: article({ status: 'content_final' }) })
  assert.equal(state.mode, 'review_preview')
  assert.equal(state.lastMessage, 'Enviado para revisão.')
})

test('APPROVE_SUCCESS transitions the mode to read_only', () => {
  let state = editorialEditorReducer(initialEditorialEditorState(), { type: 'LOAD_SUCCESS', article: article({ status: 'content_final' }) })
  state = editorialEditorReducer(state, { type: 'APPROVE_START' })
  state = editorialEditorReducer(state, { type: 'APPROVE_SUCCESS', article: article({ status: 'ready_for_render' }) })
  assert.equal(state.mode, 'read_only')
})

test('DISPATCH_SUCCESS transitions the mode to read_only with the dispatched status', () => {
  let state = editorialEditorReducer(initialEditorialEditorState(), { type: 'LOAD_SUCCESS', article: article({ status: 'ready_for_render' }) })
  state = editorialEditorReducer(state, { type: 'DISPATCH_START' })
  assert.equal(state.status, 'dispatching')
  state = editorialEditorReducer(state, { type: 'DISPATCH_SUCCESS', article: article({ status: 'dispatched', candidate_news_id: 'c1' }) })
  assert.equal(state.mode, 'read_only')
  assert.equal(state.article.status, 'dispatched')
  assert.equal(state.lastMessage, 'Enviado para renderização.')
})

test('2B.2.3: an approval that succeeds but whose dispatch then fails never undoes the approval -- the article stays ready_for_render, not reverted to content_final or lost', () => {
  let state = editorialEditorReducer(initialEditorialEditorState(), { type: 'LOAD_SUCCESS', article: article({ status: 'content_final' }) })
  state = editorialEditorReducer(state, { type: 'APPROVE_START' })
  state = editorialEditorReducer(state, { type: 'APPROVE_SUCCESS', article: article({ status: 'ready_for_render', headline: 'Aprovado de verdade' }) })
  assert.equal(state.mode, 'read_only')
  assert.equal(state.article.status, 'ready_for_render')

  state = editorialEditorReducer(state, { type: 'DISPATCH_START' })
  state = editorialEditorReducer(state, { type: 'DISPATCH_ERROR', error: { code: 'DISPATCH_FAILED' } })
  assert.equal(state.status, 'idle')
  assert.equal(state.error.code, 'DISPATCH_FAILED')
  assert.equal(state.mode, 'read_only', 'still read-only, still frozen -- not bounced back to an editable mode')
  assert.equal(state.article.status, 'ready_for_render', 'approval is not rolled back by a dispatch failure')
  assert.equal(state.article.headline, 'Aprovado de verdade', 'the approved article itself is not lost or replaced')
})

test('REQUEST_CHANGES_SUCCESS transitions the mode to changes_requested', () => {
  let state = editorialEditorReducer(initialEditorialEditorState(), { type: 'LOAD_SUCCESS', article: article({ status: 'content_final' }) })
  state = editorialEditorReducer(state, { type: 'REQUEST_CHANGES_START' })
  state = editorialEditorReducer(state, { type: 'REQUEST_CHANGES_SUCCESS', article: article({ status: 'changes_requested' }) })
  assert.equal(state.mode, 'changes_requested')
})

test('DISMISS_MESSAGE clears both the toast message and any lingering error without touching the form', () => {
  let state = editorialEditorReducer(initialEditorialEditorState(), { type: 'LOAD_SUCCESS', article: article() })
  state = editorialEditorReducer(state, { type: 'SAVE_ERROR', error: { code: 'FORBIDDEN' } })
  state = editorialEditorReducer(state, { type: 'DISMISS_MESSAGE' })
  assert.equal(state.error, null)
  assert.equal(state.lastMessage, null)
  assert.equal(state.form.headline, 'Título')
})
