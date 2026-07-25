import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PUBLICATION_VEHICLES,
  isPublicationVehicle,
  sponsorCountForVehicle,
  vehicleLabel,
  availableVehiclesForFormat,
} from '../../src/services/publicationVehicles.js'

// The vehicle FIXES the sponsor count; the operator never picks it separately.
test('sponsor count is fixed by the vehicle', () => {
  assert.equal(sponsorCountForVehicle('tvg_itumbiara'), 1)
  assert.equal(sponsorCountForVehicle('tvg'), 2)
  assert.equal(sponsorCountForVehicle('itumbiara'), 2)
  assert.equal(sponsorCountForVehicle('unknown'), null)
})

test('vehicle catalog is exactly the three publication vehicles', () => {
  assert.deepEqual(
    PUBLICATION_VEHICLES.map(vehicle => vehicle.slug).sort(),
    ['itumbiara', 'tvg', 'tvg_itumbiara'],
  )
  assert.ok(isPublicationVehicle('tvg'))
  assert.ok(!isPublicationVehicle('natal'))
  assert.equal(vehicleLabel('tvg_itumbiara'), 'TVG + Itumbiara')
})

const FEED_LAYERS = {
  headline: 'titulo-materia',
  news_image: 'news-image',
  visual_title: 'titulo-png',
  sponsor_1: 'patrocinador-1',
  sponsor_2: 'patrocinador-2',
}
function config(over = {}) {
  return {
    content_type: 'feed',
    template_set: 'tvg',
    master_template_uuid: 'tpl-feed-tvg',
    enabled: true,
    layer_map: { ...FEED_LAYERS },
    ...over,
  }
}

test('a vehicle is available only when its config is enabled, complete and the kill switch is off', () => {
  const configs = [
    config({ template_set: 'tvg_itumbiara', master_template_uuid: 'tpl-1' }),
    config({ template_set: 'tvg', master_template_uuid: 'tpl-2' }),
    config({ template_set: 'itumbiara', enabled: false }), // disabled → excluded
  ]
  const available = availableVehiclesForFormat(configs, { kill_switch: false }, 'feed')
  assert.deepEqual(available.map(v => v.slug), ['tvg_itumbiara', 'tvg'])
})

test('the kill switch removes every vehicle', () => {
  const configs = [config({ template_set: 'tvg' }), config({ template_set: 'itumbiara' })]
  assert.deepEqual(availableVehiclesForFormat(configs, { kill_switch: true }, 'feed'), [])
})

test('an incomplete config (missing layer) does not offer its vehicle', () => {
  const broken = config({ template_set: 'tvg', layer_map: { ...FEED_LAYERS, visual_title: '' } })
  assert.deepEqual(availableVehiclesForFormat([broken], { kill_switch: false }, 'feed'), [])
})

test('vehicles are scoped by format: a feed config does not enable a reels vehicle', () => {
  const feedOnly = [config({ template_set: 'tvg' })]
  assert.deepEqual(availableVehiclesForFormat(feedOnly, { kill_switch: false }, 'reels'), [])
})
