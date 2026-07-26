import assert from 'node:assert/strict'
import test from 'node:test'
import {
  availableVisualModelsForFormat,
  isVisualModel,
  sponsorCountForVisualModel,
  VISUAL_MODELS,
  visualModelLabel,
} from '../../src/services/visualModels.js'

const FEED_LAYERS = {
  headline: 'titulo-materia',
  news_image: 'news-image',
  visual_title: 'titulo-png',
  sponsor_1: 'patrocinador-1',
  sponsor_2: 'patrocinador-2',
}
const REELS_LAYERS = {
  headline: 'titulo-materia',
  visual_title: 'titulo-png',
  sponsor_1: 'patrocinador-1',
  sponsor_2: 'patrocinador-2',
}

const config = (contentType, visualModel, overrides = {}) => ({
  content_type: contentType,
  visual_model: visualModel,
  master_template_uuid: 'uuid-' + contentType + '-' + visualModel,
  enabled: true,
  layer_map: contentType === 'reels' ? REELS_LAYERS : FEED_LAYERS,
  ...overrides,
})

test('the catalog is exactly the two visual models', () => {
  assert.deepEqual(VISUAL_MODELS.map(model => model.slug), ['tvg', 'misto'])
  assert.equal(VISUAL_MODELS.length, 2)
  // Itumbiara isolada was removed from the product: it must not come back.
  assert.ok(!VISUAL_MODELS.some(model => model.slug.includes('itumbiara')))
  assert.equal(visualModelLabel('tvg'), 'TVG')
  assert.equal(visualModelLabel('misto'), 'Misto')
})

test('sponsor count is fixed by the visual model', () => {
  assert.equal(sponsorCountForVisualModel('tvg'), 2)
  assert.equal(sponsorCountForVisualModel('misto'), 1)
  assert.equal(sponsorCountForVisualModel('itumbiara'), null)
  assert.equal(sponsorCountForVisualModel(''), null)
  assert.ok(isVisualModel('tvg') && isVisualModel('misto'))
  assert.ok(!isVisualModel('itumbiara') && !isVisualModel('default'))
})

test('a model is available only when its config is enabled, complete and the kill switch is off', () => {
  const configs = [config('feed', 'tvg'), config('feed', 'misto')]
  assert.deepEqual(
    availableVisualModelsForFormat(configs, {}, 'feed').map(m => m.slug),
    ['tvg', 'misto'],
  )
  assert.deepEqual(
    availableVisualModelsForFormat(
      [config('feed', 'tvg'), config('feed', 'misto', { enabled: false })],
      {},
      'feed',
    ).map(m => m.slug),
    ['tvg'],
  )
})

test('the kill switch removes every model', () => {
  const configs = [config('feed', 'tvg'), config('feed', 'misto')]
  assert.deepEqual(
    availableVisualModelsForFormat(configs, { kill_switch: true }, 'feed'),
    [],
  )
})

test('an incomplete config (missing layer or UUID) does not offer its model', () => {
  const noUuid = config('feed', 'misto', { master_template_uuid: '' })
  const noSeal = config('feed', 'misto', {
    layer_map: { ...FEED_LAYERS, visual_title: '' },
  })
  const noNewsImage = config('feed', 'misto', {
    layer_map: { ...FEED_LAYERS, news_image: '' },
  })
  for (const broken of [noUuid, noSeal, noNewsImage]) {
    assert.deepEqual(
      availableVisualModelsForFormat(
        [config('feed', 'tvg'), broken],
        {},
        'feed',
      ).map(m => m.slug),
      ['tvg'],
    )
  }
})

test('models are scoped by format: a feed config never enables a reels model', () => {
  const feedOnly = [config('feed', 'tvg'), config('feed', 'misto')]
  assert.deepEqual(availableVisualModelsForFormat(feedOnly, {}, 'reels'), [])

  const reelsOnly = [config('reels', 'tvg'), config('reels', 'misto')]
  assert.deepEqual(availableVisualModelsForFormat(reelsOnly, {}, 'feed'), [])
})

test('reels configs stay complete without news_image', () => {
  const configs = [config('reels', 'tvg'), config('reels', 'misto')]
  assert.deepEqual(
    availableVisualModelsForFormat(configs, {}, 'reels').map(m => m.slug),
    ['tvg', 'misto'],
  )
})
