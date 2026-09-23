import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')

test('link creation skips image upload and extracts source image before saving production intent', async () => {
  const [wizard, canonical, form, scraper] = await Promise.all([
    source('src/components/editorial/ArticleWizard.jsx'),
    source('src/components/editorial/CanonicalArticleWizard.jsx'),
    source('src/components/editorial/ArticleForm.jsx'),
    source('supabase/functions/ap-link-scraper/index.ts'),
  ])

  assert.match(wizard, /formData\.source_mode !== 'link'.*list\.push\(\{ key: 'imagem'/)
  assert.match(form, /mode === 'admin' \? !formData\.url_original : sourceMode !== 'link'/)
  assert.match(canonical, /const scraped = await scrapeArticleSource\(supabase, formData\.url_original\)/)
  assert.match(canonical, /sourceImageUrl = \(scraped\.image_url \|\| ''\)\.trim\(\)/)
  assert.match(canonical, /if \(isLink && requiresSourceImage\(\) && !sourceImageUrl\)/)
  assert.match(canonical, /captureEditorialArticleSource\(supabase, \{/)
  assert.match(canonical, /sourceImageUrl: sourceImageUrl \|\| null/)
  assert.match(canonical, /saveEditorialArticleProductionIntent\(supabase, buildProductionIntentPayload/)
  assert.match(scraper, /meta\[property='og:image:secure_url'\]/)
})
