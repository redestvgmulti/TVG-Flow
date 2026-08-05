import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  composerFormErrors,
  loadTerritorialComposer,
  territorialComposerIntent,
} from '../../src/services/territorialComposer.js'
import {
  normalizeComposerMode,
  validateTerritorialComposerIntent,
} from '../../supabase/functions/ap-employee-generator/territorialComposer.ts'

const root = new URL('../../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')
const id = suffix => `10000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`

function supabaseMock({ enabled, flagError = null, catalog = {} }) {
  const calls = []
  const client = {
    schema(schema) {
      assert.equal(schema, 'ap')
      return {
        from(table) {
          calls.push(['from', table])
          return {
            select(columns) {
              calls.push(['select', columns])
              return {
                eq(column, value) {
                  calls.push(['eq', column, value])
                  return {
                    async maybeSingle() {
                      return flagError
                        ? { data: null, error: flagError }
                        : { data: enabled === undefined ? null : { enabled }, error: null }
                    },
                  }
                },
              }
            },
          }
        },
        async rpc(name, args) {
          calls.push(['rpc', name, args])
          return { data: catalog, error: null }
        },
      }
    },
  }
  return { client, calls }
}

test('flag off or absent preserves the legacy flow and performs no catalog RPC', async () => {
  for (const enabled of [false, undefined]) {
    const mock = supabaseMock({ enabled })
    const result = await loadTerritorialComposer(mock.client, id(1))
    assert.equal(result.enabled, false)
    assert.equal(result.status, 'disabled')
    assert.equal(mock.calls.some(call => call[0] === 'rpc'), false)
  }
})

test('missing additive schema is a safe disabled fallback', async () => {
  const mock = supabaseMock({
    flagError: { code: 'PGRST205', message: 'Could not find territorial_composer_features' },
  })
  const result = await loadTerritorialComposer(mock.client, id(1))
  assert.equal(result.enabled, false)
  assert.equal(result.status, 'disabled')
})

test('tenant A enabled and tenant B disabled remain isolated', async () => {
  const catalog = {
    available_formats: [
      { content_type: 'feed', requires_source_image: true },
      { content_type: 'reels', requires_source_image: false },
      { content_type: 'story', requires_source_image: false },
    ],
    regions: [{ id: id(2), nome: 'Sul' }],
  }
  const tenantA = supabaseMock({ enabled: true, catalog })
  const tenantB = supabaseMock({ enabled: false, catalog })

  const [resultA, resultB] = await Promise.all([
    loadTerritorialComposer(tenantA.client, id(10)),
    loadTerritorialComposer(tenantB.client, id(20)),
  ])

  assert.equal(resultA.enabled, true)
  assert.equal(resultA.status, 'ready')
  assert.deepEqual(
    resultA.catalog.available_formats.map(item => item.slug),
    ['feed', 'reels', 'story'],
  )
  assert.equal(resultB.enabled, false)
  assert.equal(tenantA.calls.filter(call => call[0] === 'rpc').length, 1)
  assert.equal(tenantB.calls.filter(call => call[0] === 'rpc').length, 0)
})

test('enabled tenant fails closed until all three format templates exist', async () => {
  const mock = supabaseMock({
    enabled: true,
    catalog: {
      available_formats: [{ content_type: 'feed', requires_source_image: true }],
    },
  })
  await assert.rejects(
    () => loadTerritorialComposer(mock.client, id(1)),
    /template ativo para Feed, Reels e Stories/,
  )
})

test('frontend intent sends IDs and positions but never URLs, sponsors or template data', () => {
  const form = {
    content_type: 'feed',
    composer_mode: 'individual',
    visual_title_id: id(1),
    region_id: id(2),
    city_id: id(3),
    manual_slots: [
      { slot: 'footer_slot_3', source_type: 'sponsor', source_id: id(4), url: 'forbidden' },
      { slot: 'footer_slot_1', source_type: 'region', source_id: id(5), template_uuid: 'forbidden' },
    ],
  }
  assert.deepEqual(territorialComposerIntent(form), {
    composer_mode: 'individual',
    region_id: null,
    city_id: null,
    visual_title_id: id(1),
    manual_slots: [
      { slot: 'footer_slot_3', source_type: 'sponsor', source_id: id(4) },
      { slot: 'footer_slot_1', source_type: 'region', source_id: id(5) },
    ],
  })
})

test('Stories Individual hides and rejects a visually ineffective seal', () => {
  const form = {
    content_type: 'story',
    composer_mode: 'individual',
    visual_title_id: id(1),
    manual_slots: [{ slot: 'footer_slot_2', source_type: 'sponsor', source_id: id(2) }],
  }
  assert.equal(territorialComposerIntent(form).visual_title_id, null)
  const backendError = validateTerritorialComposerIntent({
    mode: normalizeComposerMode('individual'),
    contentType: 'story',
    regionId: null,
    cityId: null,
    visualTitleId: id(1),
    manualSlots: form.manual_slots,
    rawVisualModel: null,
  })
  assert.equal(backendError.code, 'STORY_VISUAL_TITLE_FORBIDDEN')
})

test('conditional validation covers Editorial, Cities and one-to-three manual slots', () => {
  const catalog = { available_formats: [{ content_type: 'feed' }] }
  assert.deepEqual(
    Object.keys(composerFormErrors({
      content_type: 'feed',
      composer_mode: 'editorial',
      visual_title_id: null,
      region_id: null,
    }, catalog)).sort(),
    ['region_id', 'visual_title_id'],
  )
  assert.equal(
    composerFormErrors({
      content_type: 'feed',
      composer_mode: 'cities',
      city_id: null,
    }, catalog).city_id,
    'Selecione uma cidade.',
  )
  assert.equal(
    composerFormErrors({
      content_type: 'feed',
      composer_mode: 'individual',
      visual_title_id: id(1),
      manual_slots: [],
    }, catalog).manual_slots,
    'Preencha pelo menos um slot inferior.',
  )
})

test('both form owners preserve the legacy branch and use composer intent only when enabled', async () => {
  const [form, admin, employee] = await Promise.all([
    source('src/components/editorial/ArticleForm.jsx'),
    source('src/pages/admin/AutoPublisher.jsx'),
    source('src/pages/admin/EmployeeMode.jsx'),
  ])
  assert.match(form, /!territorialComposerEnabled && \(visualModelsLoaded/)
  assert.match(form, /territorialComposerEnabled && territorialComposerState === 'ready'/)
  assert.match(form, /if \(territorialComposerEnabled\) \{[\s\S]*manual_slots: \[\]/)
  for (const owner of [admin, employee]) {
    assert.match(owner, /const payload = territorialComposer\.enabled/)
    assert.match(owner, /\? \{ \.\.\.basePayload, \.\.\.territorialComposerIntent\(formData\), idempotency_key: idempotencyKey \}/)
    assert.match(owner, /:\s*\{[\s\S]*visual_model/)
    assert.doesNotMatch(owner, /payload\.(?:master_template_uuid|layer_map|sponsor_count)/)
  }
})

test('city selector supports partial local search, region labels and thumbnails', async () => {
  const component = await source('src/components/editorial/TerritorialComposerFields.jsx')
  assert.match(component, /includes\(query\)/)
  assert.match(component, /city\.region_name/)
  assert.match(component, /Miniatura de/)
  assert.match(component, /overflowX: 'hidden'/)
  assert.match(component, /footer_slot_\$\{index \+ 1\}/)
})
