import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isMasterV1Available,
  masterV1ConfigIssues,
  masterV1Status,
  requiredLayersFor,
  nonEmptyLayer,
} from '../../src/services/masterV1Availability.js'

const feedLayers = {
  headline: 'headline_news',
  tag: 'tag_news',
  news_image: 'news-image',
  visual_title: 'titulo-materia',
  sponsor_1: 'patrocinador-1',
  sponsor_2: 'patrocinador-2',
}
function feedConfig(over = {}) {
  return { content_type: 'feed', master_template_uuid: 'tpl-feed', layer_map: { ...feedLayers }, enabled: true, ...over }
}
function withLayer(config, key, value) {
  return { ...config, layer_map: { ...config.layer_map, [key]: value } }
}

test('complete + enabled → available', () => {
  assert.equal(isMasterV1Available(feedConfig(), { kill_switch: false }), true)
})

test('disabled config → unavailable', () => {
  assert.equal(isMasterV1Available(feedConfig({ enabled: false }), {}), false)
})

test('no config row → unavailable', () => {
  assert.equal(isMasterV1Available(null, {}), false)
})

test('kill switch → unavailable even when enabled and complete', () => {
  assert.equal(isMasterV1Available(feedConfig(), { kill_switch: true }), false)
})

test('template missing → invalid', () => {
  assert.deepEqual(masterV1ConfigIssues(feedConfig({ master_template_uuid: '' })), ['master_template_uuid'])
})

test('headline layer missing → invalid', () => {
  assert.ok(masterV1ConfigIssues(withLayer(feedConfig(), 'headline', '')).includes('layer:headline'))
})

test('news_image layer missing (feed) → invalid', () => {
  assert.ok(masterV1ConfigIssues(withLayer(feedConfig(), 'news_image', '')).includes('layer:news_image'))
})

test('visual_title layer missing → invalid', () => {
  assert.ok(masterV1ConfigIssues(withLayer(feedConfig(), 'visual_title', '')).includes('layer:visual_title'))
})

test('sponsor_1 layer missing → invalid', () => {
  assert.ok(masterV1ConfigIssues(withLayer(feedConfig(), 'sponsor_1', '')).includes('layer:sponsor_1'))
})

test('whitespace-only layer value → invalid', () => {
  assert.equal(nonEmptyLayer('   '), false)
  assert.ok(masterV1ConfigIssues(withLayer(feedConfig(), 'visual_title', '   ')).includes('layer:visual_title'))
})

test('sponsor_2 absent with a single sponsor → allowed', () => {
  const config = feedConfig()
  delete config.layer_map.sponsor_2
  assert.deepEqual(masterV1ConfigIssues(config), [])
  assert.equal(isMasterV1Available(config, {}), true)
})

test('reels does not require news_image or tag', () => {
  const config = { content_type: 'reels', master_template_uuid: 'tpl-reels', layer_map: { headline: 'h', visual_title: 't', sponsor_1: 's1' }, enabled: true }
  assert.deepEqual(masterV1ConfigIssues(config), [])
  assert.equal(isMasterV1Available(config, {}), true)
  assert.ok(!requiredLayersFor('reels').includes('news_image'))
  assert.ok(!requiredLayersFor('reels').includes('tag'))
})

test('status reflects each state', () => {
  assert.equal(masterV1Status(null, {}), 'no_config')
  assert.equal(masterV1Status(feedConfig(), { kill_switch: true }), 'kill_switch')
  assert.equal(masterV1Status(feedConfig({ enabled: false }), {}), 'disabled')
  assert.equal(masterV1Status(withLayer(feedConfig(), 'visual_title', ''), {}), 'incomplete')
  assert.equal(masterV1Status(feedConfig(), {}), 'active')
})
