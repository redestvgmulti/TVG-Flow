import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  RenderContractError,
} from '../../supabase/functions/ap-render-engine/renderContract.ts'
import {
  prepareTerritorialComposerRender,
} from '../../supabase/functions/ap-render-engine/territorialRenderContract.ts'

const root = new URL('../../', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')
const uuid = suffix => `70000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`
const asset = suffix => ({
  source_id: uuid(suffix),
  bucket: 'ap-test-assets',
  path: `fixture/${suffix}.png`,
  version: `v${suffix}`,
  sha256: 'a'.repeat(64),
})

const MAPS = {
  feed: {
    headline: 'titulo-materia',
    news_image: 'news-image',
    visual_title: 'selo-png',
    footer_slot_1: 'patrocinador-1',
    footer_slot_2: 'patrocinador-2',
    footer_slot_3: 'patrocinador-3',
  },
  reels: {
    headline: 'titulo-materia',
    visual_title: 'selo-png',
    footer_slot_1: 'patrocinador-1',
    footer_slot_2: 'patrocinador-2',
    footer_slot_3: 'patrocinador-3',
  },
  story: {
    footer_slot_1: 'patrocinador-1',
    footer_slot_2: 'patrocinador-2',
    footer_slot_3: 'patrocinador-3',
  },
}

function candidate(contentType, layerMap = MAPS[contentType]) {
  return {
    id: uuid(99),
    cliente_id: uuid(98),
    content_type: contentType,
    render_contract_version: 'territorial_composer_v1',
    render_snapshot: {
      render_contract_version: 'territorial_composer_v1',
      composer: { content_type: contentType, mode: 'editorial' },
      template: { master_template_uuid: `sandbox_${contentType}_template` },
      layer_map: layerMap,
      render_content: {
        headline: 'TESTE FICTÍCIO',
        source_image_url: 'https://assets.example.test/news.png',
      },
      visual_title: contentType === 'story' ? null : asset(1),
      footer_slots: [
        { slot: 'footer_slot_1', source_type: 'region', ...asset(2) },
        { slot: 'footer_slot_2', source_type: 'sponsor', ...asset(3) },
        { slot: 'footer_slot_3', source_type: 'sponsor', ...asset(4) },
      ],
    },
  }
}

test('inspected Feed, Reels and Stories maps produce only their permitted layers', () => {
  const feed = prepareTerritorialComposerRender(candidate('feed'), 'https://local.test')
  assert.deepEqual(Object.keys(feed.layers).sort(), [
    'news-image', 'patrocinador-1', 'patrocinador-2', 'patrocinador-3', 'selo-png', 'titulo-materia',
  ])

  const reels = prepareTerritorialComposerRender(candidate('reels'), 'https://local.test')
  assert.deepEqual(Object.keys(reels.layers).sort(), [
    'patrocinador-1', 'patrocinador-2', 'patrocinador-3', 'selo-png', 'titulo-materia',
  ])

  const story = prepareTerritorialComposerRender(candidate('story'), 'https://local.test')
  assert.deepEqual(Object.keys(story.layers).sort(), [
    'patrocinador-1', 'patrocinador-2', 'patrocinador-3',
  ])
})

test('Story rejects all non-footer logical layers and duplicate footer names', () => {
  for (const key of ['headline', 'news_image', 'visual_title']) {
    const map = { ...MAPS.story, [key]: `${key}-layer` }
    assert.throws(
      () => prepareTerritorialComposerRender(candidate('story', map), 'https://local.test'),
      error => error instanceof RenderContractError,
    )
  }
  const duplicate = { ...MAPS.story, footer_slot_3: MAPS.story.footer_slot_2 }
  assert.throws(
    () => prepareTerritorialComposerRender(candidate('story', duplicate), 'https://local.test'),
    error => error instanceof RenderContractError && error.code === 'COMPOSER_LAYER_MAP_INVALID',
  )
})

test('inspected maps live in tenant configuration, not renderer constants', async () => {
  const [renderer, migration] = await Promise.all([
    read('supabase/functions/ap-render-engine/territorialRenderContract.ts'),
    read('supabase/migrations/20260806090000_autopublisher_story_footer_only_layer_map.sql'),
  ])
  for (const templateId of ['yeepfqrsxhsjz', 'z13fdzn6g9glm', 'x3djtbgorrtqc']) {
    assert.doesNotMatch(renderer, new RegExp(templateId))
  }
  assert.match(migration, /p_content_type = 'feed'[\s\S]*'news_image'/)
  assert.match(migration, /p_content_type = 'reels'[\s\S]*'visual_title'/)
  assert.match(migration, /p_content_type = 'story'[\s\S]*'footer_slot_3'/)
})
