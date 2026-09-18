import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mergeLegacyAndEditorialWork,
  normalizeEditorialWorkItem,
  normalizeLegacyWorkItem,
} from '../../src/services/editorialWorkNormalization.js'

test('normalizeLegacyWorkItem tags origin and builds a stable unique id', () => {
  const item = normalizeLegacyWorkItem({ id: 'leg-1', status: 'adopted' })
  assert.equal(item.origin, 'legacy')
  assert.equal(item.uniqueId, 'legacy-leg-1')
})

test('normalizeEditorialWorkItem maps headline/dates onto the legacy-shaped display fields', () => {
  const item = normalizeEditorialWorkItem({
    id: 'ed-1', article_id: 'ed-1', headline: 'Título', created_at: '2026-01-01T00:00:00Z',
    finalized_at: '2026-01-02T00:00:00Z', first_finalized_at: '2026-01-02T00:00:00Z',
  })
  assert.equal(item.origin, 'editorial')
  assert.equal(item.uniqueId, 'editorial-ed-1')
  assert.equal(item.titulo, 'Título')
  assert.equal(item.adopted_at, '2026-01-01T00:00:00Z')
  assert.equal(item.production_completed_at, '2026-01-02T00:00:00Z')
})

test('normalizeEditorialWorkItem falls back to a placeholder title when no revision headline exists yet', () => {
  const item = normalizeEditorialWorkItem({ id: 'ed-2', article_id: 'ed-2', headline: null })
  assert.equal(item.titulo, 'Matéria sem título')
})

test('mergeLegacyAndEditorialWork drops the legacy backlog row once an editorial article already covers the same pauta', () => {
  const legacy = [
    { id: 'backlog-1', status: 'adopted', titulo: 'Pauta A' },
    { id: 'backlog-2', status: 'adopted', titulo: 'Pauta B' },
  ]
  const editorial = [
    { id: 'ed-1', article_id: 'ed-1', news_backlog_id: 'backlog-1', status: 'draft', headline: 'Pauta A em produção' },
  ]
  const merged = mergeLegacyAndEditorialWork(legacy, editorial)
  assert.equal(merged.length, 2, 'backlog-1 must not appear twice (once as legacy, once as editorial)')
  assert.ok(merged.some(item => item.uniqueId === 'editorial-ed-1'))
  assert.ok(merged.some(item => item.uniqueId === 'legacy-backlog-2'))
  assert.ok(!merged.some(item => item.uniqueId === 'legacy-backlog-1'))
})

test('mergeLegacyAndEditorialWork keeps a direct-origin editorial article (no news_backlog_id) alongside unrelated legacy items', () => {
  const legacy = [{ id: 'backlog-1', status: 'adopted' }]
  const editorial = [{ id: 'ed-1', article_id: 'ed-1', news_backlog_id: null, status: 'draft', headline: 'Direto' }]
  const merged = mergeLegacyAndEditorialWork(legacy, editorial)
  assert.equal(merged.length, 2)
})

test('mergeLegacyAndEditorialWork tolerates missing/empty inputs', () => {
  assert.deepEqual(mergeLegacyAndEditorialWork(null, null), [])
  assert.deepEqual(mergeLegacyAndEditorialWork(undefined, undefined), [])
  assert.equal(mergeLegacyAndEditorialWork([{ id: 'a' }], []).length, 1)
})
