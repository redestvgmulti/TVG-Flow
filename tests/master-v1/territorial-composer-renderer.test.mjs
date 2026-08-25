import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectRenderPath,
  RenderContractError,
} from '../../supabase/functions/ap-render-engine/renderContract.ts'
import {
  prepareTerritorialComposerRender,
} from '../../supabase/functions/ap-render-engine/territorialRenderContract.ts'

const SUPABASE_URL = 'https://local-project.supabase.co'
const uuid = suffix => `20000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`
const asset = (suffix, path = `assets/${suffix}.png`) => ({
  source_id: uuid(suffix),
  bucket: 'ap-images',
  path,
  version: `v-${suffix}`,
  sha256: String((suffix % 9) + 1).repeat(64),
})

function item(contentType, mode, slotCount = 3) {
  const layerMap = {
    footer_slot_1: 'regiao-1',
    footer_slot_2: 'patrocinador-1',
    footer_slot_3: 'patrocinador-2',
  }
  if (contentType !== 'story') {
    layerMap.headline = 'titulo-materia'
    layerMap.visual_title = 'titulo-png'
  }
  if (contentType === 'feed') layerMap.news_image = 'news-image'

  return {
    id: uuid(90),
    cliente_id: uuid(91),
    content_type: contentType,
    headline: `${contentType} ${mode}`,
    context_tag: 'DESTAQUE',
    imagem_url: contentType === 'feed' ? 'https://local.test/source.png' : null,
    render_contract_version: 'territorial_composer_v1',
    render_snapshot: {
      render_contract_version: 'territorial_composer_v1',
      composer: { mode, content_type: contentType },
      template: {
        config_id: uuid(92),
        master_template_uuid: `composer_${contentType}_local`,
      },
      layer_map: layerMap,
      render_content: {
        headline: `${contentType} ${mode}`,
        context_tag: 'DESTAQUE',
        ...(contentType === 'feed'
          ? { source_image_url: 'https://local.test/source.png' } : {}),
      },
      visual_title: contentType === 'story'
        ? null
        : { ...asset(1, 'visual-titles/title.png'), id: uuid(1) },
      footer_slots: [
        { slot: 'footer_slot_1', source_type: 'region', ...asset(2, 'regions/region.png') },
        { slot: 'footer_slot_2', source_type: 'sponsor', ...asset(3, 'sponsors/a.png') },
        { slot: 'footer_slot_3', source_type: 'sponsor', ...asset(4, 'sponsors/b.png') },
      ].slice(0, slotCount),
      sponsor_selection: mode === 'individual'
        ? {
          rotation_version: 'manual_slots_v1',
          requested_count: 0,
          selected_count: 0,
          items: [],
        }
        : {
          rotation_version: 'territorial_region_rotation_v1',
          requested_count: 2,
          selected_count: 2,
          items: [
            { slot: 'footer_slot_2', sponsor_id: uuid(3) },
            { slot: 'footer_slot_3', sponsor_id: uuid(4) },
          ],
        },
    },
  }
}

for (const contentType of ['feed', 'reels', 'story']) {
  for (const mode of ['editorial', 'cities', 'individual']) {
    test(`${contentType} plus ${mode} uses only frozen composer layers`, () => {
      const candidate = item(contentType, mode, mode === 'individual' ? 1 : 3)
      const before = structuredClone(candidate)
      const first = prepareTerritorialComposerRender(candidate, SUPABASE_URL)
      const retry = prepareTerritorialComposerRender(candidate, SUPABASE_URL)

      assert.equal(first.path, 'territorial_composer_v1')
      assert.equal(first.templateId, `composer_${contentType}_local`)
      assert.deepEqual(first, retry)
      assert.deepEqual(candidate, before)
      if (contentType === 'story') {
        assert.equal(first.layers['titulo-materia'], undefined)
      } else {
        assert.equal(first.layers['titulo-materia'].text, `${contentType} ${mode}`)
      }
      candidate.headline = 'mutated after snapshot'
      candidate.context_tag = 'MUTATED'
      candidate.imagem_url = 'https://local.test/mutated.png'
      const afterMutation = prepareTerritorialComposerRender(candidate, SUPABASE_URL)
      assert.deepEqual(afterMutation, first)
      assert.match(first.layers['regiao-1'].image, /regions\/region\.png$/)

      if (contentType === 'story') {
        assert.equal(first.layers['titulo-png'], undefined)
        assert.equal(first.layers['news-image'], undefined)
      } else {
        assert.match(first.layers['titulo-png'].image, /visual-titles\/title\.png$/)
      }
      if (contentType === 'feed') {
        assert.equal(first.layers['news-image'].image, 'https://local.test/source.png')
      }
      if (mode === 'individual') {
        assert.equal(first.layers['patrocinador-1'], undefined)
        assert.equal(first.layers['patrocinador-2'], undefined)
      }
      assert.equal(
        Object.values(first.layers).some(layer =>
          Object.values(layer).some(value => value === '' || value == null)),
        false,
      )
    })
  }
}

test('contract dispatch is explicit and legacy snapshots retain their old path', () => {
  assert.equal(detectRenderPath(item('feed', 'editorial')), 'territorial_composer_v1')
  assert.equal(detectRenderPath({ render_contract_version: 'legacy' }), 'legacy')
  assert.throws(
    () => detectRenderPath({ render_contract_version: 'territorial_composer_v1' }),
    error => error instanceof RenderContractError && error.code === 'COMPOSER_SNAPSHOT_MISSING',
  )
})

test('Story rejects a visual title layer even when the snapshot includes a title asset', () => {
  const candidate = item('story', 'editorial')
  candidate.render_snapshot.layer_map.visual_title = 'titulo-png'
  candidate.render_snapshot.visual_title = { ...asset(1), id: uuid(1) }
  assert.throws(
    () => prepareTerritorialComposerRender(candidate, SUPABASE_URL),
    error => error instanceof RenderContractError &&
      error.code === 'STORY_VISUAL_TITLE_LAYER_FORBIDDEN',
  )
})

test('missing footer slot 3 and duplicate physical footer layers fail before provider dispatch', () => {
  const missingThirdLayer = item('feed', 'editorial')
  delete missingThirdLayer.render_snapshot.layer_map.footer_slot_3
  assert.throws(
    () => prepareTerritorialComposerRender(missingThirdLayer, SUPABASE_URL),
    error => error instanceof RenderContractError &&
      error.code === 'COMPOSER_LAYER_MAP_INVALID' &&
      error.message.endsWith(': footer_slot_3'),
  )

  const duplicatedFooterLayer = item('reels', 'editorial')
  duplicatedFooterLayer.render_snapshot.layer_map.footer_slot_3 =
    duplicatedFooterLayer.render_snapshot.layer_map.footer_slot_2
  assert.throws(
    () => prepareTerritorialComposerRender(duplicatedFooterLayer, SUPABASE_URL),
    error => error instanceof RenderContractError &&
      error.code === 'COMPOSER_LAYER_MAP_INVALID' &&
      error.message.endsWith(': duplicate_layer'),
  )
})

test('automatic composition rejects a single sponsor before provider dispatch', () => {
  const candidate = item('reels', 'editorial', 2)
  candidate.render_snapshot.sponsor_selection.selected_count = 1
  candidate.render_snapshot.sponsor_selection.items.pop()

  assert.throws(
    () => prepareTerritorialComposerRender(candidate, SUPABASE_URL),
    error => error instanceof RenderContractError &&
      error.code === 'AUTOMATIC_FOOTER_INCOMPLETE',
  )
})

test('automatic composition rejects sponsor selection that diverges from footer slots', () => {
  const candidate = item('feed', 'cities')
  candidate.render_snapshot.sponsor_selection.items[1].sponsor_id = uuid(5)

  assert.throws(
    () => prepareTerritorialComposerRender(candidate, SUPABASE_URL),
    error => error instanceof RenderContractError &&
      error.code === 'AUTOMATIC_SPONSOR_SELECTION_INVALID',
  )
})

test('required format layers, composer format and template token fail closed', () => {
  const missingTitleLayer = item('feed', 'editorial')
  delete missingTitleLayer.render_snapshot.layer_map.visual_title
  assert.throws(
    () => prepareTerritorialComposerRender(missingTitleLayer, SUPABASE_URL),
    error => error instanceof RenderContractError &&
      error.code === 'COMPOSER_LAYER_MAP_INVALID' &&
      error.message.endsWith(': visual_title'),
  )

  const wrongFormat = item('reels', 'cities')
  wrongFormat.render_snapshot.composer.content_type = 'feed'
  assert.throws(
    () => prepareTerritorialComposerRender(wrongFormat, SUPABASE_URL),
    error => error instanceof RenderContractError &&
      error.code === 'COMPOSER_SNAPSHOT_INVALID' &&
      error.message.endsWith(': composer'),
  )

  const invalidTemplateToken = item('story', 'individual', 1)
  invalidTemplateToken.render_snapshot.template.master_template_uuid = 'bad uuid!'
  assert.throws(
    () => prepareTerritorialComposerRender(invalidTemplateToken, SUPABASE_URL),
    error => error instanceof RenderContractError &&
      error.code === 'COMPOSER_TEMPLATE_UUID_INVALID',
  )
})

test('missing template, invalid layer map, missing source image and empty slots fail closed', () => {
  const missingTemplate = item('feed', 'editorial')
  delete missingTemplate.render_snapshot.template.master_template_uuid
  assert.throws(
    () => prepareTerritorialComposerRender(missingTemplate, SUPABASE_URL),
    error => error.code === 'COMPOSER_TEMPLATE_UUID_MISSING',
  )

  const collision = item('reels', 'editorial')
  collision.render_snapshot.layer_map.footer_slot_3 = 'patrocinador-1'
  assert.throws(
    () => prepareTerritorialComposerRender(collision, SUPABASE_URL),
    error => error.code === 'COMPOSER_LAYER_MAP_INVALID',
  )

  const noSource = item('feed', 'editorial')
  delete noSource.render_snapshot.render_content.source_image_url
  assert.throws(
    () => prepareTerritorialComposerRender(noSource, SUPABASE_URL),
    error => error.code === 'SOURCE_IMAGE_REQUIRED',
  )

  const invalidSource = item('feed', 'editorial')
  invalidSource.render_snapshot.render_content.source_image_url = 'javascript:alert(1)'
  assert.throws(
    () => prepareTerritorialComposerRender(invalidSource, SUPABASE_URL),
    error => error.code === 'SOURCE_IMAGE_REQUIRED',
  )

  const noSlots = item('story', 'individual', 0)
  assert.throws(
    () => prepareTerritorialComposerRender(noSlots, SUPABASE_URL),
    error => error.code === 'FOOTER_SLOTS_INVALID',
  )
})

test('renderer lifecycle delegates composer completion, failure and retries to atomic RPCs', async () => {
  const [engine, recovery] = await Promise.all([
    import('node:fs/promises').then(fs =>
      fs.readFile(new URL('../../supabase/functions/ap-render-engine/index.ts', import.meta.url), 'utf8')),
    import('node:fs/promises').then(fs =>
      fs.readFile(new URL('../../supabase/functions/ap-render-recovery/index.ts', import.meta.url), 'utf8')),
  ])
  assert.match(engine, /complete_territorial_composer_render/)
  assert.match(engine, /fail_territorial_composer_render/)
  assert.match(recovery, /retry_territorial_composer_render/)
  assert.match(recovery, /\.eq\("render_contract_version", "territorial_composer_v1"\)/)
  assert.match(recovery, /\.eq\("status", "processing"\)/)
  assert.match(recovery, /release_territorial_composer_candidate/)
  assert.match(recovery, /GENERATION_LOCK_EXPIRED/)
})
