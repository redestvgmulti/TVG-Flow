import test from 'node:test'
import assert from 'node:assert/strict'

import {
  filterVisualTitleGroups,
  isVisualTitleCompatible,
  loadVisualTitleCatalog,
  moveComboboxActiveIndex,
  prepareVisualTitleCatalog,
  retainCompatibleVisualTitleId,
} from '../../src/services/visualTitleCatalog.js'

const groups = [
  { id: 'cities', nome: 'Cidades', ordem: 1, ativo: true },
  { id: 'sports', nome: 'Esportes', ordem: 2, ativo: true },
  { id: 'archived', nome: 'Arquivados', ordem: 0, ativo: false },
  { id: 'real-general', nome: 'Geral', ordem: 3, ativo: true },
]
const asset = { asset_bucket: 'ap-images', asset_path: 'visual-titles/cliente/selo/a.png', asset_version: 'v1', sha256: 'a' }
const titles = [
  { id: 'goiatuba', group_id: 'cities', nome: 'Goiatuba', formatos: ['feed'], ordem: 1, ativo: true, ...asset },
  { id: 'morrinhos', group_id: 'cities', nome: 'Morrinhos', formatos: ['feed', 'reels'], ordem: 0, ativo: true, ...asset },
  { id: 'futebol', group_id: 'sports', nome: 'Futebol', formatos: ['reels'], ordem: 0, ativo: true, ...asset },
  { id: 'legacy', group_id: null, nome: 'Urgente', formatos: ['feed', 'reels'], ordem: 0, ativo: true, ...asset },
  { id: 'disabled', group_id: 'cities', nome: 'Oculto', formatos: ['feed'], ordem: 2, ativo: false, ...asset },
  { id: 'archived-group-title', group_id: 'archived', nome: 'Nao mostrar', formatos: ['feed'], ordem: 0, ativo: true, ...asset },
]

test('catalog keeps active real groups and a distinct virtual Geral for legacy titles', () => {
  const catalog = prepareVisualTitleCatalog(groups, titles)
  assert.deepEqual(catalog.map(group => group.id), ['cities', 'sports', 'real-general', 'legacy-general'])
  assert.equal(catalog.find(group => group.id === 'legacy-general').nome, 'Geral (sem grupo)')
  assert.deepEqual(catalog.find(group => group.id === 'cities').titles.map(title => title.id), ['morrinhos', 'goiatuba'])
  assert.deepEqual(catalog.find(group => group.id === 'legacy-general').titles.map(title => title.id), ['legacy'])
})

test('format filters preserve only compatible titles, including Story', () => {
  const catalog = prepareVisualTitleCatalog(groups, titles)
  assert.deepEqual(filterVisualTitleGroups(catalog, 'feed').flatMap(group => group.titles.map(title => title.id)), ['morrinhos', 'goiatuba', 'legacy'])
  assert.deepEqual(filterVisualTitleGroups(catalog, 'reels').flatMap(group => group.titles.map(title => title.id)), ['morrinhos', 'futebol', 'legacy'])
  assert.equal(isVisualTitleCompatible({ formatos: ['feed', 'reels'] }, 'feed'), true)
  assert.equal(isVisualTitleCompatible({ formatos: ['feed', 'reels'] }, 'reels'), true)
  assert.equal(isVisualTitleCompatible({ formatos: ['story'] }, 'story'), true)
  assert.equal(isVisualTitleCompatible({ formatos: ['feed'] }, 'story'), false)
})

test('search matches either the seal name or its group name locally', () => {
  const catalog = prepareVisualTitleCatalog(groups, titles)
  assert.deepEqual(filterVisualTitleGroups(catalog, 'feed', 'goia').flatMap(group => group.titles.map(title => title.id)), ['goiatuba'])
  assert.deepEqual(filterVisualTitleGroups(catalog, 'feed', 'cidades').flatMap(group => group.titles.map(title => title.id)), ['morrinhos', 'goiatuba'])
  assert.deepEqual(filterVisualTitleGroups(catalog, 'reels', 'fut').flatMap(group => group.titles.map(title => title.id)), ['futebol'])
})

test('format changes retain compatible ids and clear incompatible ids without changing their payload shape', () => {
  const catalog = prepareVisualTitleCatalog(groups, titles)
  assert.equal(retainCompatibleVisualTitleId(catalog, 'morrinhos', 'reels'), 'morrinhos')
  assert.equal(retainCompatibleVisualTitleId(catalog, 'goiatuba', 'reels'), null)
  const payload = { visual_title_id: 'morrinhos' }
  assert.deepEqual(payload, { visual_title_id: 'morrinhos' })
  assert.equal('group_id' in payload, false)
  assert.equal('asset_path' in payload, false)
})

test('keyboard navigation only traverses selectable seals, never group headers', () => {
  assert.equal(moveComboboxActiveIndex(-1, 'next', 3), 0)
  assert.equal(moveComboboxActiveIndex(0, 'next', 3), 1)
  assert.equal(moveComboboxActiveIndex(2, 'next', 3), 2)
  assert.equal(moveComboboxActiveIndex(1, 'previous', 3), 0)
  assert.equal(moveComboboxActiveIndex(0, 'previous', 3), 0)
  assert.equal(moveComboboxActiveIndex(-1, 'next', 0), -1)
})

test('catalog load scopes both queries to the operational client and active records', async () => {
  const calls = []
  function query(data) {
    return { select() { return this }, eq(column, value) { calls.push([column, value]); return this }, order() { return this }, then(resolve) { return Promise.resolve({ data, error: null }).then(resolve) } }
  }
  const supabase = {
    schema() { return { from(table) { return query(table === 'visual_title_groups' ? groups.filter(group => group.ativo) : titles.filter(title => title.ativo)) } } },
    storage: { from() { return { getPublicUrl(path) { return { data: { publicUrl: `https://preview/${path}` } } } } } },
  }
  const catalog = await loadVisualTitleCatalog(supabase, 'cliente-atual')
  assert.ok(calls.filter(call => call[0] === 'cliente_id' && call[1] === 'cliente-atual').length === 2)
  assert.ok(calls.filter(call => call[0] === 'ativo' && call[1] === true).length === 2)
  assert.equal(catalog.find(group => group.id === 'cities').titles[0].preview_url.startsWith('https://preview/'), true)
})
