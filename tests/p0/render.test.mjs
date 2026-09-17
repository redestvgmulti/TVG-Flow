import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { generationAssetPath, reserveGenerationAsset, uploadGenerationAsset } from '../../supabase/functions/ap-render-engine/generationWorkflow.mjs'
import { canEditCandidate, canApproveGeneration } from '../../src/services/editorialP0.js'
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
test('Render 1 and Render 2 retain separately readable bytes; overwrite refused', async () => {
  const files = new Map()
  const client = { storage: { from: () => ({ upload: async (path, bytes, options) => {
    assert.equal(options.upsert, false)
    if (files.has(path)) return { error: { code: 'Duplicate' } }
    files.set(path, bytes); return { error: null }
  } }) } }
  const a = generationAssetPath(id(1), id(2), id(3), 'image/png')
  const b = generationAssetPath(id(1), id(2), id(4), 'image/png')
  await uploadGenerationAsset(client, a, 'Render #1', 'image/png')
  await uploadGenerationAsset(client, b, 'Render #2', 'image/png')
  assert.notEqual(a, b); assert.equal(files.get(a), 'Render #1'); assert.equal(files.get(b), 'Render #2')
  await assert.rejects(uploadGenerationAsset(client, a, 'Overwrite', 'image/png'))
  assert.equal(files.get(a), 'Render #1')
})
test('generation path is reserved before upload and failed uploads are never replaced', async () => {
  const calls = []
  const client = {
    schema: () => ({ rpc: async (name, payload) => { calls.push({ name, payload }); return { error: null } } }),
    storage: { from: () => ({ upload: async () => ({ error: { code: 'StorageFailure' } }) }) },
  }
  const generation = id(3)
  const path = generationAssetPath(id(1), id(2), generation, 'image/png')
  await reserveGenerationAsset(client, generation, path)
  await assert.rejects(uploadGenerationAsset(client, path, 'partial', 'image/png'), /RENDER_STORAGE_UPLOAD_FAILED/)
  assert.deepEqual(calls, [{
    name: 'p0_reserve_render_asset',
    payload: { p_generation_id: generation, p_asset_path: path },
  }])
})
test('render Storage writer is upload-only, append-only and independent from storage internals', async () => {
  const workflow = await readFile(new URL('../../supabase/functions/ap-render-engine/generationWorkflow.mjs', import.meta.url), 'utf8')
  const engine = await readFile(new URL('../../supabase/functions/ap-render-engine/index.ts', import.meta.url), 'utf8')
  const migration = await readFile(new URL('../../supabase/migrations/20260909014825_p0_editorial_publication_render_invariants.sql', import.meta.url), 'utf8')
  assert.match(workflow, /\.upload\(path, bytes, \{ contentType, upsert: false \}\)/)
  assert.doesNotMatch(workflow, /\.update\(|\.move\(|\.remove\(|upsert:\s*true/)
  assert.doesNotMatch(migration, /storage\.objects|render_storage_object_immutable|guard_render_object_p0/)
  assert.match(migration, /asset_path text UNIQUE/)
  assert.ok(engine.indexOf('reserveGenerationAsset(supabase, generationId, path)') < engine.indexOf('uploadGenerationAsset(supabase, path'))
  assert.ok(engine.indexOf('uploadGenerationAsset(supabase, path') < engine.indexOf('rpc("p0_complete_render"'))
  assert.match(engine, /rpc\("p0_fail_render"/)
})
test('post-render UI editing blocked, correction draft is distinct', () => {
  for (const status of ['pending_render','pending_review','approved','posted','rejected']) {
    assert.equal(canEditCandidate({ status, render_url: 'asset' }), false)
  }
  assert.equal(canEditCandidate({ status: 'changes_requested', render_url: 'old', correction_draft: {} }), true)
  assert.equal(canApproveGeneration({ status: 'pending_review', render_url: 'old' }), false)
  assert.equal(canApproveGeneration({ status: 'pending_review', render_url: 'new', current_generation_id: id(3) }), true)
})
test('UI has no fake publication call and sends the reviewed generation', async () => {
  const ui = await readFile(new URL('../../src/pages/admin/AutoPublisher.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(ui, /mark_candidate_news_posted|onPublish\(/)
  assert.doesNotMatch(ui, /instagram\.com\/p\/\$\{item\.instagram_post_id\}/)
  assert.match(ui, /generationId: item.current_generation_id, assetUrl: item.render_url/)
  assert.match(ui, /canEditCandidate\(item\)/)
})
