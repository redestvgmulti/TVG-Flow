import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { validateContentStep } from '../../src/services/editorialArticleForm.js'

const source = await readFile(new URL('../../src/components/editorial/CanonicalArticleWizard.jsx', import.meta.url), 'utf8')

// Execute the component's actual orchestration with local service doubles.
// No React lifecycle, Supabase connection or model request runs in these tests.
function componentFunction(name, next) {
  const start = source.indexOf(`  async function ${name}(`)
  const end = source.indexOf(next, start)
  assert.ok(start >= 0 && end > start, `Cannot locate ${name}`)
  return source.slice(start, end).trim()
}

const preparation = componentFunction('prepareForReview', '\n  useEffect(() => {')
const saveDraft = componentFunction('saveHumanDraft', '\n  function createAnother()')
const applyStart = source.indexOf('  function applyPreparedArticle(')
const applyPrepared = source.slice(applyStart, source.indexOf('\n  async function resolveProductionImageUrl', applyStart)).trim()
const formStart = source.indexOf('function canonicalFormFromWizard(')
const canonicalForm = source.slice(formStart, source.indexOf('\nexport default function', formStart)).trim()

const originalBody = 'A comissão informou que receberá os documentos na sexta-feira.\n\nA audiência ouvirá representantes das escolas e moradores.'
const rewritten = {
  headline: 'Comissão ouvirá escolas antes de avaliar documentos',
  body: 'Escolas e moradores serão ouvidos pela comissão.\n\nOs documentos serão recebidos na sexta-feira, segundo o órgão.',
  caption: 'Comissão ouvirá escolas e moradores antes da análise dos documentos.\n\nREDE TVG MULTI - CREDIBILIDADE É TUDO!',
  context_tag: 'Educação',
  category: 'Cidades',
  location: { city: null, region: null, state: null },
}

function harness({ mode = 'manual', aiEnabled = true, aiFailures = 0, body = originalBody, prepared = false } = {}) {
  const events = []
  let captured = null
  let article = { id: 'article-1', revision_number: 0, ai_source_captured: false }
  const counts = { create: 0, capture: 0, ai: 0, scrape: 0, save: 0 }
  const context = {
    formData: { source_mode: mode, titulo: 'Pauta original da comissão', conteudo: body, content_type: 'reels', image_url: '', url_original: 'https://example.com/noticia' },
    originBacklog: null,
    preparedRef: { current: prepared },
    preparationPromiseRef: { current: null },
    articleIdRef: { current: prepared ? 'article-1' : null },
    sourceImageRef: { current: '' },
    revisionNumberRef: { current: null },
    requests: { current: {} },
    supabase: {},
    isSavingDraft: false,
    errors: {},
    setErrors(value) { context.errors = value },
    setAutomaticPreparation(value) { context.preparationStatus = value },
    setSourceLocked(value) { context.sourceLocked = value },
    setFormData(updater) { context.formData = typeof updater === 'function' ? updater(context.formData) : updater },
    setIsSavingDraft(value) { context.isSavingDraft = value },
    toast: { success() {}, error() {} },
    requestId(store, key) { return store.current[key] ||= `${key}-request` },
    resetRequestId(store, key) { store.current[key] = null },
    userFacingError(error) { return Object.assign(new Error(error.message), { userMessage: error.message }) },
    messageForRpcError(code) { return { description: code } },
    requiresSourceImage: () => false,
    missingLinkImageError: () => new Error('SOURCE_IMAGE_NOT_FOUND'),
    resolveProductionImageUrl: async value => value,
    getEditorialAiDraftStatus: async () => { events.push('flag'); return aiEnabled },
    startEditorialArticleDirect: async (_client, payload) => {
      counts.create += 1
      events.push('create')
      context.origin = payload
      return article
    },
    getEditorialArticleForEdit: async () => ({ ...article }),
    captureEditorialArticleSource: async (_client, payload) => {
      counts.capture += 1
      events.push('capture')
      captured = payload
      article = { ...article, ai_source_captured: true, original_source_title: payload.sourceTitle, original_source_body: payload.sourceBody }
    },
    prepareEditorialAiDraft: async () => {
      counts.ai += 1
      events.push('ai')
      if (counts.ai <= aiFailures) throw new Error('EDITORIAL_AI_TIMEOUT')
      article = { ...article, ...rewritten, revision_number: 1, status: 'editing' }
    },
    scrapeArticleSource: async () => {
      counts.scrape += 1
      return { title: 'Título extraído', content: originalBody, image_url: '' }
    },
    validateContentStep,
    buildDraftPayload: (form, options) => ({ ...form, ...options }),
    saveEditorialArticleDraft: async (_client, payload) => {
      counts.save += 1
      events.push('save')
      article = { ...article, ...payload, revision_number: article.revision_number + 1 }
    },
  }
  context.applyPreparedArticle = vm.runInNewContext(`(${applyPrepared})`, context)
  context.canonicalFormFromWizard = vm.runInNewContext(`(${canonicalForm})`, context)
  return {
    context, counts, events,
    prepare: vm.runInNewContext(`(${preparation})`, context),
    save: vm.runInNewContext(`(${saveDraft})`, context),
    captured: () => captured,
  }
}

test('manual input is captured as text source before AI rewrites headline, body and caption', async () => {
  const h = harness()
  await h.prepare()
  assert.equal(h.counts.ai, 1)
  assert.equal(h.counts.scrape, 0)
  assert.equal(h.counts.save, 0, 'Raw manual source must not become a final human draft before AI')
  assert.equal(h.context.origin.originType, 'text')
  assert.equal(h.captured().sourceType, 'text')
  assert.equal(h.captured().sourceBody, originalBody)
  assert.ok(h.events.indexOf('capture') < h.events.indexOf('ai'))
  assert.equal(h.context.formData.source_conteudo, originalBody)
  assert.equal(h.context.formData.titulo, rewritten.headline)
  assert.equal(h.context.formData.conteudo, rewritten.body)
  assert.equal(h.context.formData.caption, rewritten.caption)
  assert.equal(h.context.preparationStatus.status, 'ready')
})

test('link input keeps extraction and uses the same AI preparation', async () => {
  const h = harness({ mode: 'link' })
  await h.prepare()
  assert.equal(h.counts.scrape, 1)
  assert.equal(h.counts.ai, 1)
  assert.equal(h.captured().sourceType, 'link')
  assert.equal(h.context.formData.conteudo, rewritten.body)
  assert.equal(h.context.formData.caption, rewritten.caption)
})

test('manual input respects the AI feature gate without silently saving raw text', async () => {
  const h = harness({ aiEnabled: false })
  await assert.rejects(h.prepare(), /EDITORIAL_AI_DISABLED/)
  assert.equal(h.counts.create, 0)
  assert.equal(h.counts.ai, 0)
  assert.equal(h.counts.save, 0)
  assert.equal(h.context.formData.conteudo, originalBody)
})

test('manual AI failure blocks review; retry reuses the captured source and article', async () => {
  const h = harness({ aiFailures: 1 })
  await assert.rejects(h.prepare(), /EDITORIAL_AI_TIMEOUT/)
  assert.equal(h.context.preparedRef.current, false)
  assert.equal(h.context.preparationStatus.status, 'error')
  assert.equal(h.context.formData.conteudo, originalBody)
  await h.prepare()
  assert.equal(h.counts.create, 1)
  assert.equal(h.counts.capture, 1)
  assert.equal(h.counts.ai, 2)
  assert.equal(h.counts.save, 0)
  assert.equal(h.context.formData.conteudo, rewritten.body)
})

test('concurrent and repeated preparation does not generate the same manual article twice', async () => {
  const h = harness()
  await Promise.all([h.prepare(), h.prepare()])
  await h.prepare()
  assert.equal(h.counts.create, 1)
  assert.equal(h.counts.capture, 1)
  assert.equal(h.counts.ai, 1)
})

test('an already prepared article preserves subsequent human edits', async () => {
  const h = harness({ prepared: true })
  h.context.formData.conteudo = 'Texto revisado pelo editor humano, que deve ser preservado.'
  await h.prepare()
  assert.equal(h.counts.ai, 0)
  assert.equal(h.context.formData.conteudo, 'Texto revisado pelo editor humano, que deve ser preservado.')
})

test('manual source cannot be empty', async () => {
  const h = harness({ body: '   ' })
  await assert.rejects(h.prepare(), /SOURCE_BODY_REQUIRED/)
  assert.equal(h.counts.create, 0)
  assert.equal(h.counts.ai, 0)
})

test('reviewed manual input requires a caption when saving human edits', async () => {
  const h = harness()
  await h.prepare()
  h.context.formData.caption = ''
  await h.save()
  assert.ok(h.context.errors.caption)
  assert.equal(h.counts.save, 0)
})

test('saving edits after AI preparation does not rewrite them again', async () => {
  const h = harness()
  await h.prepare()
  const edited = 'Versão revisada pelo editor humano.\n\nA declaração foi conferida e o contexto foi ajustado.'
  h.context.formData.conteudo = edited
  await h.save()
  assert.equal(h.counts.ai, 1)
  assert.equal(h.counts.save, 1)
  assert.equal(h.context.formData.conteudo, edited)
  assert.equal(h.context.formData.source_conteudo, originalBody)
})
