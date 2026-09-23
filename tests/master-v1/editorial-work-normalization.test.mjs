import test from 'node:test'
import assert from 'node:assert/strict'

import {
  mergeLegacyAndEditorialWork,
  normalizeEditorialWorkItem,
  normalizeLegacyWorkItem,
  sortAdoptedWorkItems,
  sortWorkItemsByRecentActivity,
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

test('staff work lists place the latest activity first across legacy and editorial records', () => {
  const merged = mergeLegacyAndEditorialWork([
    { id: 'legacy-old', status: 'completed', adopted_at: '2026-08-31T11:07:00Z', production_completed_at: '2026-08-31T11:21:00Z' },
    { id: 'legacy-new', status: 'adopted', adopted_at: '2026-09-23T10:00:00Z' },
  ], [
    { id: 'editorial-mid', article_id: 'editorial-mid', status: 'draft', created_at: '2026-09-20T09:00:00Z', updated_at: '2026-09-21T15:49:00Z' },
  ])

  assert.deepEqual(
    sortWorkItemsByRecentActivity(merged).map(item => item.uniqueId),
    ['legacy-legacy-new', 'editorial-editorial-mid', 'legacy-legacy-old'],
  )
})

test('staff work ordering falls back to creation time and remains stable for equal dates', () => {
  const items = [
    { id: 'a', created_at: '2026-09-21T15:39:00Z' },
    { id: 'b', created_at: '2026-09-21T15:49:00Z' },
    { id: 'c', created_at: '2026-09-21T15:49:00Z' },
  ]

  assert.deepEqual(sortWorkItemsByRecentActivity(items).map(item => item.id), ['c', 'b', 'a'])
  assert.equal(items[0].id, 'a', 'sorting must not mutate the source list')
})

test('adopted pautas use adoption day and time even when a row was updated later', () => {
  const items = [
    { id: 'old', adopted_at: '2026-08-31T12:58:00Z', updated_at: '2026-09-23T12:00:00Z' },
    { id: 'new', adopted_at: '2026-09-03T18:06:00Z', updated_at: '2026-09-03T18:06:00Z' },
    { id: 'middle', adopted_at: '2026-09-01T18:41:00Z', updated_at: '2026-09-20T12:00:00Z' },
  ]

  assert.deepEqual(sortAdoptedWorkItems(items).map(item => item.id), ['new', 'middle', 'old'])
  assert.equal(items[0].id, 'old', 'sorting must not mutate the source list')
})
