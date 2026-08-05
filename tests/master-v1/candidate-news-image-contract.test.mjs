import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
const autoPublisher = await readFile(new URL('src/pages/admin/AutoPublisher.jsx', root), 'utf8')
const migrationsDirectory = new URL('supabase/migrations/', root)
const migrationFiles = (await readdir(migrationsDirectory)).filter(path => path.endsWith('.sql'))
const migrations = await Promise.all(
  migrationFiles.map(async path => readFile(new URL(path, migrationsDirectory), 'utf8')),
)

function candidateListSelect(source) {
  const match = source.match(/\.from\('candidate_news'\)\s*\.select\(`([\s\S]*?)`\)/)
  assert.ok(match, 'candidate_news list select was not found')
  return match[1]
}

test('AutoPublisher list requests only canonical candidate image fields', () => {
  const select = candidateListSelect(autoPublisher)

  assert.doesNotMatch(select, /\bimage_external\b/)
  assert.match(select, /\bimagem_url\b/)
  assert.match(select, /\bimagem_storage\b/)
  assert.match(select, /\brender_url\b/)
})

test('official candidate_news migration chain does not define image_external', () => {
  assert.doesNotMatch(migrations.join('\n'), /\bimage_external\b/)
})

test('candidate cards resolve images from the canonical persisted fields', () => {
  assert.match(autoPublisher, /item\.render_url \?\? \(item\.imagem_storage \? supabase\.storage\.from\('ap-images'\)\.getPublicUrl\(item\.imagem_storage\)\.data\.publicUrl : null\) \?\? item\.imagem_url \?\? item\.studio_media_image_url/)
  assert.doesNotMatch(autoPublisher, /item\.image_external/)
})
