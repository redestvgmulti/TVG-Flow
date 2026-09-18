import test from 'node:test'
import assert from 'node:assert/strict'

import { deriveEditorialCatalogView } from '../../src/services/editorialCatalogsView.js'
import { MASTER_RUNTIME_STATUS, VISUAL_MODELS_STATE } from '../../src/services/masterRuntime.js'
import { TERRITORIAL_COMPOSER_STATUS } from '../../src/services/territorialComposer.js'

const feedConfig = {
  content_type: 'feed', visual_model: 'tvg', enabled: true, master_template_uuid: 'tpl-1',
  sponsor_count: 0, layer_map: { headline: 'h', visual_title: 'vt', news_image: 'img' },
}

test('territorial enabled + ready: formats come from the territorial catalog, models are not offered', () => {
  const view = deriveEditorialCatalogView({
    territorialComposerEnabled: true,
    territorialComposerStatus: TERRITORIAL_COMPOSER_STATUS.READY,
    territorialCatalog: { available_formats: [{ content_type: 'feed', label: 'Feed' }] },
  })
  assert.deepEqual(view.availableFormats, [{ slug: 'feed', label: 'Feed' }])
  assert.deepEqual(view.visualModelOptions, [])
  assert.equal(view.visualModelsState, VISUAL_MODELS_STATE.AVAILABLE)
})

test('territorial enabled + still loading: no formats yet, state is loading', () => {
  const view = deriveEditorialCatalogView({
    territorialComposerEnabled: true,
    territorialComposerStatus: TERRITORIAL_COMPOSER_STATUS.LOADING,
    territorialCatalog: null,
  })
  assert.deepEqual(view.availableFormats, [])
  assert.equal(view.visualModelsState, VISUAL_MODELS_STATE.LOADING)
})

test('territorial enabled + error: state is error', () => {
  const view = deriveEditorialCatalogView({
    territorialComposerEnabled: true,
    territorialComposerStatus: TERRITORIAL_COMPOSER_STATUS.ERROR,
    territorialCatalog: null,
  })
  assert.equal(view.visualModelsState, VISUAL_MODELS_STATE.ERROR)
})

test('legacy (non-territorial) path: ready master runtime exposes available formats and, given a contentType, visual model options', () => {
  const view = deriveEditorialCatalogView({
    territorialComposerEnabled: false,
    masterRuntimeStatus: MASTER_RUNTIME_STATUS.READY,
    masterRuntime: { configs: [feedConfig], killSwitch: false, poolCounts: { feed: 0 } },
    contentType: 'feed',
  })
  assert.deepEqual(view.availableFormats.map(f => f.slug), ['feed'])
  assert.ok(view.visualModelOptions.some(model => model.slug === 'tvg' && model.available))
  assert.equal(view.visualModelsState, VISUAL_MODELS_STATE.AVAILABLE)
})

test('legacy path: no contentType selected yet means no visual model options, even if formats are ready', () => {
  const view = deriveEditorialCatalogView({
    territorialComposerEnabled: false,
    masterRuntimeStatus: MASTER_RUNTIME_STATUS.READY,
    masterRuntime: { configs: [feedConfig], killSwitch: false, poolCounts: { feed: 0 } },
    contentType: null,
  })
  assert.deepEqual(view.visualModelOptions, [])
})

test('legacy path: runtime still loading means no formats and a loading state', () => {
  const view = deriveEditorialCatalogView({
    territorialComposerEnabled: false,
    masterRuntimeStatus: MASTER_RUNTIME_STATUS.LOADING,
    masterRuntime: null,
    contentType: 'feed',
  })
  assert.deepEqual(view.availableFormats, [])
  assert.equal(view.visualModelsState, VISUAL_MODELS_STATE.LOADING)
})

test('legacy path: a runtime load failure surfaces as an error state', () => {
  const view = deriveEditorialCatalogView({
    territorialComposerEnabled: false,
    masterRuntimeStatus: MASTER_RUNTIME_STATUS.ERROR,
    masterRuntime: null,
    contentType: 'feed',
  })
  assert.equal(view.visualModelsState, VISUAL_MODELS_STATE.ERROR)
})

test('legacy path: the kill switch empties available formats even with valid configs', () => {
  const view = deriveEditorialCatalogView({
    territorialComposerEnabled: false,
    masterRuntimeStatus: MASTER_RUNTIME_STATUS.READY,
    masterRuntime: { configs: [feedConfig], killSwitch: true, poolCounts: { feed: 0 } },
    contentType: 'feed',
  })
  assert.deepEqual(view.availableFormats, [])
})
