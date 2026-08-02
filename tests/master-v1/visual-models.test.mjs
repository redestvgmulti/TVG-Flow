import assert from 'node:assert/strict'
import test from 'node:test'
import {
  availableContentTypes,
  availableVisualModelsForFormat,
  isVisualModel,
  nextVisualModel,
  VISUAL_MODELS,
  visualModelLabel,
  visualModelOptionsForFormat,
} from '../../src/services/visualModels.js'

const FEED_LAYERS = { headline: 'titulo-materia', news_image: 'news-image', visual_title: 'titulo-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' }
const REELS_LAYERS = { headline: 'titulo-materia', visual_title: 'titulo-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' }
const INDIVIDUAL_FEED_LAYERS = { headline: 'titulo-materia', news_image: 'news-image', visual_title: 'titulo-png', sponsor_1: 'patrocinador-2' }
const STORY_LAYERS = { headline: 'titulo-materia', visual_title: 'titulo-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' }
const config = (contentType, visualModel, sponsorCount, overrides = {}) => ({
  content_type: contentType,
  visual_model: visualModel,
  master_template_uuid: `uuid-${contentType}-${visualModel}`,
  enabled: true,
  sponsor_count: sponsorCount,
  layer_map: contentType === 'reels' ? REELS_LAYERS : FEED_LAYERS,
  ...overrides,
})

test('catalog uses five business codes and keeps misto presentation-only', () => {
  assert.deepEqual(VISUAL_MODELS.map(model => model.slug), ['tvg', 'tvg_img', 'individual', 'aparecida', 'story'])
  assert.equal(visualModelLabel('tvg_img'), 'TVG + IMG')
  assert.equal(visualModelLabel('misto'), 'TVG + IMG')
  assert.equal(isVisualModel('misto'), false)
})

test('format catalog is Feed=3, Reels=4 and Story=1 in the required order', () => {
  const configs = [
    config('feed', 'tvg', 2), config('feed', 'tvg_img', 1), config('feed', 'individual', 1, { layer_map: INDIVIDUAL_FEED_LAYERS }),
    config('reels', 'tvg', 2), config('reels', 'tvg_img', 1), config('reels', 'individual', 0), config('reels', 'aparecida', 0),
    config('story', 'story', 2, { layer_map: STORY_LAYERS }),
  ]
  const pool = { feed: 2, reels: 2, story: 2 }
  assert.deepEqual(availableVisualModelsForFormat(configs, {}, 'feed', pool).map(m => m.slug), ['tvg', 'tvg_img', 'individual'])
  assert.deepEqual(availableVisualModelsForFormat(configs, {}, 'reels', pool).map(m => m.slug), ['tvg', 'tvg_img', 'individual', 'aparecida'])
  assert.deepEqual(availableVisualModelsForFormat(configs, {}, 'story', pool).map(m => m.slug), ['story'])
  assert.deepEqual(availableContentTypes(configs, {}, pool).map(f => f.slug), ['feed', 'reels', 'story'])
})

test('unknown sponsor count and insufficient pool keep a purpose unavailable', () => {
  const unknown = config('reels', 'individual', null)
  assert.equal(visualModelOptionsForFormat([unknown], {}, 'reels', { reels: 2 }).find(m => m.slug === 'individual').available, false)
  const tvg = visualModelOptionsForFormat([config('feed', 'tvg', 2)], {}, 'feed', { feed: 1 }).find(m => m.slug === 'tvg')
  assert.equal(tvg.available, false)
  assert.equal(tvg.unavailableReason, 'Indisponível: patrocinadores insuficientes.')
})

test('Story remains unavailable until its two-sponsor pool exists', () => {
  const story = config('story', 'story', 2, { layer_map: STORY_LAYERS })
  const option = visualModelOptionsForFormat([story], {}, 'story', { story: 0 }).find(model => model.slug === 'story')
  assert.equal(option.available, false)
  assert.equal(option.sourceImage, 'unsupported')
  assert.match(option.unavailableReason, /patrocinadores insuficientes/)
})

test('switching format clears invalid model and auto-selects a single option', () => {
  assert.equal(nextVisualModel('tvg', [{ slug: 'story' }]), 'story')
  assert.equal(nextVisualModel('', [{ slug: 'story' }]), 'story')
  assert.equal(nextVisualModel('story', [{ slug: 'story' }]), 'story')
})

test('disabled, incomplete and cross-format configs are never selectable', () => {
  const configs = [config('feed', 'tvg', 2, { enabled: false }), config('feed', 'tvg_img', 1, { master_template_uuid: '' })]
  assert.deepEqual(availableVisualModelsForFormat(configs, {}, 'feed', { feed: 2 }), [])
  assert.deepEqual(availableVisualModelsForFormat([config('feed', 'tvg', 2)], {}, 'reels', { reels: 2 }), [])
  assert.deepEqual(availableVisualModelsForFormat([config('feed', 'tvg', 2)], { kill_switch: true }, 'feed', { feed: 2 }), [])
})
