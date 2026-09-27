import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('the server-only source resource is tenant-scoped, Instagram-only and history-safe', async () => {
  const source = await readFile(new URL('supabase/functions/ap-config/index.ts', root), 'utf8')

  assert.match(source, /instagram_sources:\s*\{ table: "sources", ownerColumn: "cliente_id"/)
  assert.match(source, /resource === "instagram_sources"/)
  assert.match(source, /clienteId: authorization\.clienteId/)
  assert.match(source, /OWNER_SCOPE_MANAGED_BY_SERVER/)
  assert.match(source, /\.eq\("tipo", "instagram"\)/)
  assert.match(source, /INSTAGRAM_SOURCE_ALREADY_EXISTS/)
  assert.match(source, /from\("collected_news"\)/)
  assert.match(source, /from\("source_ingestion_runs"\)/)
  assert.match(source, /deactivated: true/)
})

test('the Radar UI has connected, disconnected, empty, local loading and error states without collection', async () => {
  const shell = await readFile(new URL('src/components/editorial/InstagramRadarShell.jsx', root), 'utf8')

  assert.match(shell, /Conecte o Instagram para ativar o Radar\./)
  assert.match(shell, /Conectar Instagram/)
  assert.match(shell, /Nenhum perfil monitorado ainda\./)
  assert.match(shell, /Adicionar perfil/)
  assert.match(shell, /setPendingId/)
  assert.match(shell, /operationError/)
  assert.match(shell, /createInstagramSource/)
  assert.match(shell, /setInstagramSourceActive/)
  assert.match(shell, /removeInstagramSource/)
  assert.match(shell, /Nenhuma publicação coletada ainda\./)
  assert.doesNotMatch(shell, /A descoberta ainda não está ativa nesta fase\./)
})

test('the generic collector explicitly excludes Instagram until the Meta provider exists', async () => {
  const ingestion = await readFile(new URL('supabase/functions/ap-data-ingestion/index.ts', root), 'utf8')
  assert.match(ingestion, /\.neq\("tipo", "instagram"\)/)
})
