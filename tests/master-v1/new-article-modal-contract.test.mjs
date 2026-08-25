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
  assert.match(page, /className="ap-new-article-modal"/)
  assert.match(page, /ap-new-article-modal-content/)
  assert.match(styles, /\.modal\.ap-new-article-modal\s*\{[^}]*overflow:\s*hidden/)
  assert.match(styles, /\.modal\.ap-new-article-modal \.modal-body\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto/)
})

test('employee article modal constrains the shell and scrolls only its content', async () => {
  const page = await source('src/pages/admin/EmployeeMode.jsx')
  const styles = await source('src/styles/components.css')
  assert.match(page, /className="modal employee-mode-modal"/)
  assert.match(page, /className="employee-mode-modal-tabs"/)
  assert.match(page, /className=\{`employee-mode-modal-body\$\{activeTab === 'backlog' \? ' employee-mode-modal-body--backlog' : ''\}`\}/)
  assert.match(page, /aria-label="Conteúdo da nova matéria"/)
  assert.match(page, /tabIndex=\{0\}/)
  assert.match(styles, /\.modal\.employee-mode-modal\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*height:[^;]+;[^}]*overflow:\s*hidden/)
  assert.match(styles, /\.employee-mode-modal-body\s*\{[^}]*flex:\s*1 1 0%;[^}]*height:\s*0;[^}]*min-height:\s*0;[^}]*overflow-y:\s*scroll;[^}]*touch-action:\s*pan-y/)
  assert.match(styles, /\.employee-mode-modal-body--backlog\s*>\s*\.ap-backlog-panel\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1 1 0%;[^}]*min-height:\s*0/)
  assert.match(styles, /\.employee-mode-modal-body--backlog \.ap-backlog-list\s*\{[^}]*flex:\s*1 1 0%;[^}]*min-height:\s*0;[^}]*overflow-y:\s*scroll;[^}]*touch-action:\s*pan-y/)
})

test('manual Feed keeps the image dropzone visible before choosing between image-based purposes', async () => {
  const form = await source('src/components/editorial/ArticleForm.jsx')
  assert.match(form, /availableModelsRequireSourceImage = availableVisualModels\.length > 0/)
  assert.match(form, /availableVisualModels\.every\(model => model\.sourceImage === 'required'\)/)
  assert.match(form, /const sourceImageRequired = territorialComposerEnabled[\s\S]*selectedModel[\s\S]*availableModelsRequireSourceImage/)
  assert.match(form, /Clique ou arraste a imagem original aqui/)
})
