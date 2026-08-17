import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { canonicalEditorialFields } from '../supabase/functions/_shared/canonicalEditorial.mjs'

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const manualText = 'A Prefeitura de Goiatuba anunciou nesta manhã a inauguração da nova unidade.'

test('manual editorial text is preserved exactly without an LLM rewrite', () => {
  const fields = canonicalEditorialFields({
    titulo: 'Inauguração',
    conteudo: manualText,
    caption: null,
    context_tag: 'CIDADE',
  })

  assert.equal(fields.caption, manualText)
  assert.equal(fields.headline, 'Inauguração')
  assert.equal(fields.context_tag, 'CIDADE')
})

test('externally authored GPT content remains the persisted editorial content', () => {
  const externalEditorialText = 'Matéria pronta por assistente externo, sem revisão editorial automática.'
  const fields = canonicalEditorialFields({
    titulo: 'Título fornecido',
    conteudo: externalEditorialText,
    caption: null,
  })

  assert.equal(fields.caption, externalEditorialText)
  assert.equal(fields.roteiro_studio, externalEditorialText)
})

test('productive generators do not call the editorial LLM workflow', async () => {
  for (const path of [
    'supabase/functions/ap-employee-generator/index.ts',
    'supabase/functions/ap-employee-generator/territorialCandidateWorkflow.ts',
  ]) {
    const content = await source(path)
    assert.match(content, /canonicalEditorialFields/)
    assert.doesNotMatch(content, /runEditorialWorkflow|callLLM/)
  }
})

test('content production preserves persisted text and reserves approval for an authorized human', async () => {
  const content = await source('supabase/functions/ap-content-production/index.ts')
  assert.match(content, /canonicalEditorialFields/)
  assert.doesNotMatch(content, /runEditorialWorkflow|callLLM/)
  assert.match(content, /HUMAN_APPROVAL_REQUIRED/)
  assert.match(content, /requireActiveOperator\(req, createAdminClient\(\), \["admin"\]\)/)
  assert.match(content, /authorizeOperationalTenant\(/)
  assert.match(content, /\.eq\("status", "pending_review"\)/)
  assert.match(content, /\.is\("processing_started_at", null\)/)
  assert.match(content, /status: "approved"/)
  assert.match(content, /approved_by: operator\.id/)
  assert.match(content, /actionType === "approve_for_ig"/)
})

test('a completed non-territorial render enters pending_review, never approved', async () => {
  const renderer = await source('supabase/functions/ap-render-engine/index.ts')
  assert.match(renderer, /status: "pending_review"/)
  assert.doesNotMatch(renderer, /status: "approved"/)
})

test('the territorial completion RPC transitions pending_render to pending_review prospectively', async () => {
  const migration = await source('supabase/migrations/20260817110000_render_completion_requires_human_review.sql')
  assert.match(migration, /v_candidate\.status <> 'pending_render'/)
  assert.match(migration, /status = 'pending_review'/)
  assert.match(migration, /\('pending_review', 'approved', 'posted'\)/)
  assert.doesNotMatch(migration, /\bDELETE\b|\bTRUNCATE\b/i)
})

test('the AutoPublisher UI sends selected items to render and only approves pending_review', async () => {
  const ui = await source('src/pages/admin/AutoPublisher.jsx')
  assert.match(ui, /const canPrepareRender = item\.status === 'selected'/)
  assert.match(ui, /const canApproveReview = item\.status === 'pending_review'/)
  assert.match(ui, /action: canPrepareRender \? 'process_selected' : 'approve_for_ig'/)
  assert.doesNotMatch(ui, /approved_by_id:|approved_by_name:/)
  assert.doesNotMatch(ui, /processing_started_at: null[\s\S]{0,120}\.eq\('id', item\.id\)/)
})
