import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { uploadImmutablePng } from '../../src/services/masterV1Assets.js'

import {
  archiveVisualTitle,
  createVisualTitle,
  groupVisualTitles,
  listVisualTitleGroups,
  moveVisualTitle,
  resolveOperationalClienteId,
} from '../../src/services/visualTitleGroups.js'

function createSupabaseMock({ data = [], error = null, rpcData = 'cliente-runtime' } = {}) {
  const calls = []
  const response = { data, error }
  const query = {
    select() { calls.push(['select']); return query },
    eq(column, value) { calls.push(['eq', column, value]); return query },
    order(column) { calls.push(['order', column]); return query },
    insert(payload) { calls.push(['insert', payload]); return query },
    update(payload) { calls.push(['update', payload]); return query },
    single() { calls.push(['single']); return Promise.resolve(response) },
    then(resolve, reject) { return Promise.resolve(response).then(resolve, reject) },
  }
  return {
    calls,
    schema(name) { calls.push(['schema', name]); return { from(table) { calls.push(['from', table]); return query } } },
    rpc(name) { calls.push(['rpc', name]); return Promise.resolve({ data: rpcData, error }) },
  }
}

test('resolves the operational client through the approved runtime RPC', async () => {
  const supabase = createSupabaseMock({ rpcData: 'cliente-operacional' })
  assert.equal(await resolveOperationalClienteId(supabase), 'cliente-operacional')
  assert.deepEqual(supabase.calls, [['rpc', 'get_agencia_cliente_id']])
})

test('all group reads are scoped to the operational client', async () => {
  const supabase = createSupabaseMock()
  await listVisualTitleGroups(supabase, 'cliente-a')
  assert.ok(supabase.calls.some(call => call[0] === 'eq' && call[1] === 'cliente_id' && call[2] === 'cliente-a'))
})

test('new administrative records cannot create a title without a real group', async () => {
  const supabase = createSupabaseMock()
  await assert.rejects(() => createVisualTitle(supabase, 'cliente-a', { nome: 'Goiatuba' }), /Escolha um grupo/)
  assert.equal(supabase.calls.some(call => call[0] === 'insert'), false)
})

test('legacy titles remain visible in the virtual Geral group', () => {
  const groups = [{ id: 'cities', nome: 'Cidades', ordem: 0, ativo: true }]
  const titles = [
    { id: 'old', nome: 'Urgente', group_id: null, ordem: 0, ativo: true },
    { id: 'city', nome: 'Goiatuba', group_id: 'cities', ordem: 0, ativo: true },
  ]
  const result = groupVisualTitles(groups, titles)
  assert.deepEqual(result.map(group => [group.id, group.titles.map(title => title.id)]), [['cities', ['city']], ['legacy-general', ['old']]])
})

test('moving a title changes only its group association and preserves its identifier and asset', async () => {
  const supabase = createSupabaseMock({ data: { id: 'seal-1', group_id: 'sports' } })
  await moveVisualTitle(supabase, 'cliente-a', 'seal-1', 'sports')
  const update = supabase.calls.find(call => call[0] === 'update')
  assert.deepEqual(update, ['update', { group_id: 'sports' }])
  assert.ok(supabase.calls.some(call => call[0] === 'eq' && call[1] === 'id' && call[2] === 'seal-1'))
  assert.equal(JSON.stringify(update).includes('asset_'), false)
})

test('archiving changes availability instead of deleting the title or its PNG', async () => {
  const supabase = createSupabaseMock({ data: { id: 'seal-1' } })
  await archiveVisualTitle(supabase, 'cliente-a', 'seal-1')
  assert.deepEqual(supabase.calls.find(call => call[0] === 'update'), ['update', { ativo: false }])
  assert.equal(supabase.calls.some(call => call[0] === 'delete'), false)
})

test('administrative settings do not retain a fixed client UUID', async () => {
  const source = await readFile(new URL('../../src/pages/admin/AutoPublisher.jsx', import.meta.url), 'utf8')
  assert.equal(source.includes('cd287e6e-f273-4d0f-a72d-2a8c391e40e9'), false)
  assert.equal(source.includes('resolveOperationalClienteId'), true)
})
function pngFile(name = 'seal.png', type = 'image/png', size = 3) {
  const bytes = new Uint8Array(size).fill(7)
  return { name, type, size, arrayBuffer: async () => bytes.buffer }
}

test('PNG uploads use immutable visual-title paths and never upsert', async () => {
  const uploads = []
  const supabase = { storage: { from(bucket) { return { upload: async (path, file, options) => { uploads.push({ bucket, path, file, options }); return { error: null } } } } } }
  const asset = await uploadImmutablePng({ supabase, file: pngFile(), clienteId: 'cliente-a', kind: 'visual-titles', slug: 'goiatuba' })
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].bucket, 'ap-images')
  assert.match(uploads[0].path, /^visual-titles\/cliente-a\/goiatuba\/[a-f0-9]{64}\.png$/)
  assert.equal(uploads[0].options.upsert, false)
  assert.equal(asset.path, uploads[0].path)
})

test('invalid PNG uploads are rejected before Storage is called', async () => {
  const supabase = { storage: { from() { throw new Error('Storage should not be reached') } } }
  await assert.rejects(() => uploadImmutablePng({ supabase, file: pngFile('seal.jpg', 'image/jpeg'), clienteId: 'cliente-a', kind: 'visual-titles', slug: 'seal' }), /PNG/)
})