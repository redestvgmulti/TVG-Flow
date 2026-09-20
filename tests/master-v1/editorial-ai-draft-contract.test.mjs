import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  parseEditorialAiDraft,
  providerFromBaseUrl,
  sanitizedAiErrorCode,
} from '../../supabase/functions/_shared/editorialAiDraftContract.ts'
import { callLLM } from '../../supabase/functions/_shared/llmClient.ts'

const validDraft = {
  headline: 'Prefeitura conclui etapa administrativa de teste',
  body: 'A Prefeitura informou nesta sexta-feira que concluiu uma etapa administrativa usada exclusivamente em uma validação técnica.',
  caption: 'Etapa administrativa de teste foi concluída nesta sexta-feira.',
  context_tag: 'administração pública',
  category: 'Cidades',
  location: { city: null, region: null, state: null },
}

test('strict AI draft parser accepts exactly the canonical structured output', () => {
  assert.deepEqual(parseEditorialAiDraft(JSON.stringify(validDraft)), validDraft)
})

test('strict AI draft parser rejects invalid, partial, fenced and augmented output', () => {
  assert.throws(() => parseEditorialAiDraft('{invalid'), /EDITORIAL_AI_INVALID_JSON/)
  assert.throws(() => parseEditorialAiDraft(JSON.stringify({ ...validDraft, caption: '' })), /EDITORIAL_AI_INVALID_CAPTION/)
  assert.throws(() => parseEditorialAiDraft(`\`\`\`json\n${JSON.stringify(validDraft)}\n\`\`\``), /EDITORIAL_AI_INVALID_JSON/)
  assert.throws(() => parseEditorialAiDraft(JSON.stringify({ ...validDraft, reasoning: 'hidden' })), /EDITORIAL_AI_INVALID_SCHEMA/)
  assert.throws(() => parseEditorialAiDraft(JSON.stringify({ ...validDraft, location: { city: null } })), /EDITORIAL_AI_INVALID_LOCATION/)
})

test('provider routing and persisted errors expose only stable metadata', () => {
  assert.equal(providerFromBaseUrl('https://api.anthropic.com'), 'anthropic')
  assert.equal(providerFromBaseUrl('https://generativelanguage.googleapis.com'), 'google')
  assert.equal(providerFromBaseUrl('https://openrouter.ai/api/v1'), 'openrouter')
  assert.equal(providerFromBaseUrl('https://api.openai.com/v1'), 'openai-compatible')
  assert.equal(sanitizedAiErrorCode(new Error('request timed out')), 'EDITORIAL_AI_TIMEOUT')
  assert.equal(sanitizedAiErrorCode(new Error('provider leaked private details')), 'EDITORIAL_AI_PROVIDER_FAILURE')
})

test('LLM client fails explicitly on timeout and provider failure', async () => {
  const originalFetch = globalThis.fetch
  const originalConsoleError = console.error
  const params = {
    apiKey: 'test-key', baseUrl: 'https://api.openai.com/v1', model: 'test-model',
    prompt: 'source only', temperature: 0, maxTokens: 100, timeoutMs: 5,
  }
  console.error = () => {}
  try {
    globalThis.fetch = async () => { throw new DOMException('timed out', 'TimeoutError') }
    await assert.rejects(callLLM(params), /EDITORIAL_AI_TIMEOUT/)

    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'provider unavailable' } }), { status: 503 })
    await assert.rejects(callLLM(params), /LLM Error 503/)
  } finally {
    globalThis.fetch = originalFetch
    console.error = originalConsoleError
  }
})

test('dedicated AI edge function is user-authenticated, tenant-derived and editorial-only', async () => {
  const [edge, prompt, client, editor, service] = await Promise.all([
    readFile(new URL('../../supabase/functions/ap-editorial-ai-draft/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/functions/_shared/editorialPromptBuilder.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/functions/_shared/llmClient.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../src/components/editorial/CanonicalEditorialEditor.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/services/editorialArticlesService.js', import.meta.url), 'utf8'),
  ])

  assert.match(edge, /auth\.getUser\(token\)/)
  assert.match(edge, /claim_editorial_ai_draft/)
  assert.match(edge, /claim\.cliente_id/)
  assert.doesNotMatch(edge, /payload\?\.cliente_id|FIXED_CLIENT_ID/)
  assert.doesNotMatch(edge, /candidate_news|ap-render|placid|instagram|approve_editorial/)
  assert.match(prompt, /buildCanonicalEditorialDraftPrompt/)
  assert.match(prompt, /Não pesquise na web\. Não acrescente fatos/)
  assert.doesNotMatch(client, /interleaved-thinking/)
  assert.match(client, /AbortSignal\.timeout\(timeoutMs\)/)
  assert.match(editor, /Preparando matéria/)
  assert.match(editor, /Tentar novamente/)
  assert.match(editor, /captureEditorialArticleSource/)
  assert.match(editor, /scrapeArticleSource[\s\S]+prepareAiDraft/)
  assert.match(service, /functions\.invoke\('ap-link-scraper'/)
})

test('legacy production workers remain free of the old editorial workflow and LLM client', async () => {
  for (const path of [
    '../../supabase/functions/ap-content-production/index.ts',
    '../../supabase/functions/ap-employee-generator/index.ts',
  ]) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /runEditorialWorkflow|callLLM/)
  }
})
