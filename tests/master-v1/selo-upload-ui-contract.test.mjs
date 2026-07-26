import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)
async function source(path) { return readFile(new URL(path, root), 'utf8') }

test('the normalizer preserves alpha by construction and never applies a background', async () => {
  const src = await source('src/services/seloPngNormalizer.js')
  // Transparent canvas + alpha context, never a fill/background.
  assert.match(src, /getContext\('2d', \{ alpha: true \}\)/)
  assert.match(src, /clearRect\(/)
  assert.doesNotMatch(src, /fillRect|fillStyle|globalCompositeOperation/)
  // Output stays PNG — never JPG/WebP.
  assert.match(src, /type: 'image\/png'/)
  assert.doesNotMatch(src, /image\/(jpeg|jpg|webp)/)
})

test('the normalizer decodes off the main thread and bounds the shrink loop', async () => {
  const src = await source('src/services/seloPngNormalizer.js')
  assert.match(src, /createImageBitmap\(/)
  assert.match(src, /attempts < MAX_COMPRESSION_ATTEMPTS/)
  assert.match(src, /MAX_OUTPUT_BYTES = 5 \* 1024 \* 1024/)
  assert.match(src, /MAX_INPUT_BYTES = 15 \* 1024 \* 1024/)
  // The final file is what leaves the normalizer.
  assert.match(src, /new File\(\[blob\], finalName\(file\.name\), \{ type: 'image\/png' \}\)/)
})

test('only the normalized file is uploaded, and the hash is taken over that final file', async () => {
  const manager = await source('src/components/editorial/VisualTitlesManager.jsx')
  // The raw candidate is never uploaded: the parent only receives result.file.
  assert.match(manager, /normalizeSeloPng\(candidate/)
  assert.match(manager, /onChange\(result\.file\)/)
  assert.match(manager, /uploadImmutablePng\(\{ supabase, file: titleFile/)

  const assets = await source('src/services/masterV1Assets.js')
  // sha256 is computed over the exact file passed in (the normalized one).
  assert.match(assets, /crypto\.subtle\.digest\('SHA-256', await file\.arrayBuffer\(\)\)/)
  // Path stays tenant-scoped and the upload is immutable (new asset on replace).
  assert.match(assets, /\$\{kind\}\/\$\{clienteId\}\/\$\{safeSlug\}\/\$\{checksum\}\.png/)
  assert.match(assets, /upsert: false/)
})

test('the upload UI shows original vs optimized details and blocks submit while processing', async () => {
  const manager = await source('src/components/editorial/VisualTitlesManager.jsx')
  // Progress messages.
  assert.match(manager, /Analisando imagem…/)
  assert.match(manager, /Otimizando PNG…/)
  assert.match(manager, /Imagem pronta para envio\./)
  // Before/after figures.
  assert.match(manager, /meta\.original\.width/)
  assert.match(manager, /meta\.final\.bytes/)
  assert.match(manager, /formatBytes\(/)
  // Submit is disabled while the image is processing (no double submit).
  assert.match(manager, /disabled=\{saving \|\| processingImage\}/)
  // A new selection supersedes an in-flight one (race guard) and clears state.
  assert.match(manager, /tokenRef/)
  assert.match(manager, /onChange\(null\)/)
  // The new UX copy replaces the old "5 MB" hint.
  assert.match(manager, /Recomendado: 1230 × 464 px\. Imagens grandes são otimizadas automaticamente\./)
})
