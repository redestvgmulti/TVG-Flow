import test from 'node:test'
import assert from 'node:assert/strict'
import { isMasterV1Available, masterV1ConfigIssues, masterV1Status, requiredLayersFor, nonEmptyLayer, sourceImageRequirement } from '../../src/services/masterV1Availability.js'

const feedLayers = { headline: 'headline_news', news_image: 'news-image', visual_title: 'titulo-materia', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' }
function feedConfig(over = {}) {
  return { content_type: 'feed', master_template_uuid: 'tpl-feed', sponsor_count: 2, layer_map: { ...feedLayers }, enabled: true, ...over }
}
function withLayer(config, key, value) {
  return { ...config, layer_map: { ...config.layer_map, [key]: value } }
}

test('enabled complete config also requires a sufficient distinct sponsor pool', () => {
  assert.equal(isMasterV1Available(feedConfig(), {}, 2), true)
  assert.equal(isMasterV1Available(feedConfig(), {}, 1), false)
  assert.equal(masterV1Status(feedConfig(), {}, 1), 'sponsor_pool')
})

test('technical completeness comes from sponsor_count and layer_map', () => {
  assert.deepEqual(masterV1ConfigIssues(feedConfig({ master_template_uuid: '' })), ['master_template_uuid'])
  assert.ok(masterV1ConfigIssues(withLayer(feedConfig(), 'headline', '')).includes('layer:headline'))
  assert.ok(masterV1ConfigIssues(withLayer(feedConfig(), 'news_image', '')).includes('layer:news_image'))
  assert.ok(masterV1ConfigIssues(withLayer(feedConfig(), 'visual_title', '')).includes('layer:visual_title'))
  assert.ok(masterV1ConfigIssues(withLayer(feedConfig(), 'sponsor_2', '')).includes('layer:sponsor_2'))
  assert.ok(masterV1ConfigIssues(feedConfig({ sponsor_count: null })).includes('sponsor_count'))
  assert.equal(nonEmptyLayer('   '), false)
})

test('one sponsor needs one slot and zero sponsors need no sponsor layers', () => {
  const one = feedConfig({ sponsor_count: 1, layer_map: { ...feedLayers, sponsor_2: undefined } })
  assert.deepEqual(masterV1ConfigIssues(one), [])
  const story = { content_type: 'story', master_template_uuid: 'story-template', sponsor_count: 0, layer_map: { headline: 'h', visual_title: 't' }, enabled: true }
  assert.deepEqual(masterV1ConfigIssues(story), [])
  assert.deepEqual(requiredLayersFor('story', 0, story.layer_map), ['headline', 'visual_title'])
})

test('Reels rejects news-image while Story follows its frozen map', () => {
  const reels = { content_type: 'reels', master_template_uuid: 'r-template', sponsor_count: 0, layer_map: { headline: 'h', visual_title: 't', news_image: 'image' }, enabled: true }
  assert.ok(masterV1ConfigIssues(reels).includes('layer:news_image_not_supported'))
  const storyWithImage = { ...reels, content_type: 'story' }
  assert.deepEqual(masterV1ConfigIssues(storyWithImage), [])
})

test('Individual Feed requires source image and Story fails closed without its two-sponsor pool', () => {
  const individualFeed = {
    content_type: 'feed',
    master_template_uuid: '4e7pghwb4beji',
    sponsor_count: 1,
    layer_map: { headline: 'titulo-materia', news_image: 'news-image', visual_title: 'titulo-png', sponsor_1: 'patrocinador-2' },
    enabled: true,
  }
  assert.deepEqual(masterV1ConfigIssues(individualFeed), [])
  assert.equal(sourceImageRequirement(individualFeed), 'required')
  assert.equal(isMasterV1Available(individualFeed, {}, 1), true)

  const story = {
    content_type: 'story',
    master_template_uuid: 'x3djtbqorrtqc',
    sponsor_count: 2,
    layer_map: { headline: 'titulo-materia', visual_title: 'titulo-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' },
    enabled: true,
  }
  assert.deepEqual(masterV1ConfigIssues(story), [])
  assert.equal(sourceImageRequirement(story), 'unsupported')
  assert.equal(isMasterV1Available(story, {}, 0), false)
  assert.equal(masterV1Status(story, {}, 0), 'sponsor_pool')
  assert.equal(isMasterV1Available(story, {}, 2), true)
})

test('status remains fail-closed for every administrative state', () => {
  assert.equal(masterV1Status(null, {}, 0), 'no_config')
  assert.equal(masterV1Status(feedConfig(), { kill_switch: true }, 2), 'kill_switch')
  assert.equal(masterV1Status(feedConfig({ enabled: false }), {}, 2), 'disabled')
  assert.equal(masterV1Status(withLayer(feedConfig(), 'visual_title', ''), {}, 2), 'incomplete')
  assert.equal(masterV1Status(feedConfig(), {}, 2), 'active')
})
