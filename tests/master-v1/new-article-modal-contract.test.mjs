import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  isMasterV1Available,
  masterV1UnavailableMessage,
} from '../../src/services/masterV1Availability.js'

const root = new URL('../../', import.meta.url)
async function source(path) { return readFile(new URL(path, root), 'utf8') }

test('a disabled preset remains fail-closed and reports its homologation state', () => {
  const config = {
    content_type: 'feed',
    master_template_uuid: '4e7pghwb4beji',
    sponsor_count: 1,
    layer_map: {
      headline: 'titulo-materia',
      news_image: 'news-image',
      visual_title: 'titulo-png',
      sponsor_1: 'patrocinador-2',
    },
    enabled: false,
  }
  assert.equal(isMasterV1Available(config, {}, 1), false)
  assert.equal(masterV1UnavailableMessage(config, {}, 1), 'Indispon\u00edvel: aguardando homologa\u00e7\u00e3o.')
})

test('new article modal owns an internal scroll container without changing the shared modal', async () => {
  const page = await source('src/pages/admin/AutoPublisher.jsx')
  const styles = await source('src/styles/AutoPublisher.css')
  assert.match(page, /ap-new-article-modal-content/)
  assert.match(styles, /\.modal\.modal-large:has\(\.ap-new-article-modal-content\)/)
  assert.match(styles, /\.modal-body[\s\S]*overflow-y:\s*auto/)
})
