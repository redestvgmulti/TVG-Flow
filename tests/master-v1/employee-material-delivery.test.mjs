import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  inferEmployeeSourceMode,
  normalizeEmployeeSourceMode,
  validateEmployeeSourceQuality,
} from '../../supabase/functions/ap-employee-generator/sourceQuality.ts'

const read = relativePath => readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8')

test('premium employee source modes reject placeholder-quality material', () => {
  assert.equal(normalizeEmployeeSourceMode(' IMAGE '), 'image')
  assert.equal(normalizeEmployeeSourceMode('other'), null)
  assert.equal(inferEmployeeSourceMode('https://example.test/news', null), 'link')

  assert.equal(
    validateEmployeeSourceQuality({
      sourceMode: 'text',
      headline: 'Pauta OMNI',
      text: 'teste',
      sourceUrl: null,
      imageUrl: null,
    })?.code,
    'SOURCE_TEXT_TOO_SHORT',
  )

  assert.equal(
    validateEmployeeSourceQuality({
      sourceMode: 'image',
      headline: 'Obra avança em Goiânia',
      text: 'Registro da obra nesta manhã, com local e contexto confirmados.',
      sourceUrl: null,
      imageUrl: 'https://example.test/photo.jpg',
    }),
    null,
  )
})

test('migration repairs employee visibility without weakening security_invoker', async () => {
  const migration = await read('supabase/migrations/20260815232001_employee_material_delivery_contract.sql')

  assert.match(migration, /DROP POLICY IF EXISTS ap_news_tenant_isolation/)
  assert.match(migration, /FOR SELECT TO authenticated[\s\S]*cliente_id IN \(SELECT ap\.get_user_cliente_ids\(\)\)[\s\S]*criado_por_user_id = \(SELECT auth\.uid\(\)\)[\s\S]*cliente_id IN \(SELECT ap\.get_operational_cliente_ids\(\)\)/)
  assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.record_employee_material_action/)
  assert.match(migration, /v_creator_id IS DISTINCT FROM v_user_id/)
  assert.match(migration, /candidate\.acao_baixou OR p_action = 'download'/)
  assert.doesNotMatch(migration, /SET\s+status\s*=/i)
  assert.doesNotMatch(migration, /security_invoker\s*=\s*false/i)
})

test('private realtime topic is bound to the authenticated creator', async () => {
  const migration = await read('supabase/migrations/20260815232001_employee_material_delivery_contract.sql')

  assert.match(migration, /realtime\.broadcast_changes/)
  assert.match(migration, /employee-material:' \|\| NEW\.criado_por_user_id/)
  assert.match(migration, /extension = 'broadcast'/)
  assert.match(migration, /split_part\(\(SELECT realtime\.topic\(\)\), ':', 2\) = \(SELECT auth\.uid\(\)\)::text/)
})

test('generator returns the delivery contract and schedules the exact render', async () => {
  const generator = await read('supabase/functions/ap-employee-generator/index.ts')
  const workflow = await read('supabase/functions/_shared/editorialWorkflow.ts')
  const llmClient = await read('supabase/functions/_shared/llmClient.ts')

  for (const field of ['content_type', 'template_nome', 'render_url', 'render_completed_at', 'downloaded', 'copied']) {
    assert.match(generator, new RegExp(`${field}:`))
  }
  assert.match(generator, /EdgeRuntime\.waitUntil\(task\)/)
  assert.match(generator, /body: JSON\.stringify\(\{ news_id: news\.id \}\)/)
  assert.match(generator, /validateEmployeeSourceQuality/)
  assert.match(workflow, /sourceMode === "image"/)
  assert.match(llmClient, /type: 'image'/)
  assert.match(llmClient, /source: \{ type: 'url', url: normalizedImageUrl \}/)
})

test('employee UI records real actions and never promotes an invented status', async () => {
  const employeeMode = await read('src/pages/admin/EmployeeMode.jsx')
  const articleForm = await read('src/components/editorial/ArticleForm.jsx')
  const vite = await read('vite.config.js')

  assert.match(employeeMode, /rpc\('record_employee_material_action'/)
  assert.match(employeeMode, /config: \{ private: true \}/)
  assert.match(employeeMode, /disabled=\{!renderUrl \|\| isDownloading\}/)
  assert.match(employeeMode, /Download iniciado/)
  assert.match(employeeMode, /newsId === successData\?\.news_id/)
  assert.match(employeeMode, /<CreatorSignature[\s\S]*successData\.creator_name[\s\S]*createdAt=\{successData\.created_at/)
  assert.doesNotMatch(employeeMode, /status\s*=\s*['"]published['"]/)
  assert.doesNotMatch(employeeMode, /setIsPublished/)
  assert.match(articleForm, /Fonte analisada/)
  assert.match(articleForm, /Confirmar e gerar material/)
  assert.match(vite, /urlPattern:[^\n]+rest[^\n]+\n\s*handler: 'NetworkOnly'/)
})
