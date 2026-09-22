import assert from 'node:assert/strict'
import test from 'node:test'
import {
  composerModeFromArticle,
  sourceImageForRender,
} from '../../supabase/functions/ap-editorial-render-dispatch/composerModeFromArticle.ts'

const REGION = '10000000-0000-4000-8000-000000000001'
const CITY = '20000000-0000-4000-8000-000000000002'
const SLOT = { slot: 'footer_slot_1', source_type: 'sponsor', source_id: '30000000-0000-4000-8000-000000000003' }

test('region_id alone resolves to editorial mode', () => {
  assert.equal(composerModeFromArticle({ region_id: REGION, city_id: null, manual_slots: null }), 'editorial')
})

test('only Feed carries a source image into the render candidate', () => {
  const image = 'https://images.example.com/source.jpg'

  assert.equal(sourceImageForRender({ content_type: 'feed', source_image_url: image }), image)
  assert.equal(sourceImageForRender({ content_type: 'reels', source_image_url: image }), null)
  assert.equal(sourceImageForRender({ content_type: 'story', source_image_url: image }), null)
  assert.equal(sourceImageForRender({ content_type: 'feed', source_image_url: null }), null)
})

test('city_id alone resolves to cities mode', () => {
  assert.equal(composerModeFromArticle({ region_id: null, city_id: CITY, manual_slots: [] }), 'cities')
})

test('manual_slots alone resolves to individual mode', () => {
  assert.equal(composerModeFromArticle({ region_id: null, city_id: null, manual_slots: [SLOT] }), 'individual')
})

test('nothing set resolves to null, not a guess', () => {
  assert.equal(composerModeFromArticle({ region_id: null, city_id: null, manual_slots: [] }), null)
  assert.equal(composerModeFromArticle({ region_id: null, city_id: null, manual_slots: null }), null)
})

test('conflicting fields (region + city, or region + slots) resolve to null rather than picking one', () => {
  assert.equal(composerModeFromArticle({ region_id: REGION, city_id: CITY, manual_slots: [] }), null)
  assert.equal(composerModeFromArticle({ region_id: REGION, city_id: null, manual_slots: [SLOT] }), null)
  assert.equal(composerModeFromArticle({ region_id: null, city_id: CITY, manual_slots: [SLOT] }), null)
})

test('empty-string ids are treated as unset, not as a value', () => {
  assert.equal(composerModeFromArticle({ region_id: '', city_id: null, manual_slots: [SLOT] }), 'individual')
})
