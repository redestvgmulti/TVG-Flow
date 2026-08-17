import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  SafeLinkFetchError,
  assertPublicHttpUrl,
  fetchPublicHtml,
  sanitizeUrlForLog,
} from '../supabase/functions/_shared/safeLinkFetcher.mjs'

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const publicDns = async (_host, type) => type === 'A' ? ['93.184.216.34'] : []

async function rejectCode(promise, code) {
  await assert.rejects(promise, (error) => error instanceof SafeLinkFetchError && error.code === code)
}

test('scraper accepts a public HTML response and preserves its consumer contract', async () => {
  const result = await fetchPublicHtml('https://news.example.com/article', {
    resolveDns: publicDns,
    fetchImpl: async () => new Response('<html><title>Noticia</title></html>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
  })
  assert.equal(result.finalUrl, 'https://news.example.com/article')
  assert.match(result.html, /Noticia/)

  const scraper = await source('supabase/functions/ap-link-scraper/index.ts')
  for (const field of ['title:', 'image_url:', 'content:', 'studio_media_image_url:', 'studio_media_video_url:']) {
    assert.match(scraper, new RegExp(field))
  }
})

test('scraper rejects non-http schemes and local/private destinations', async () => {
  await rejectCode(assertPublicHttpUrl('file:///etc/passwd', publicDns), 'UNSUPPORTED_PROTOCOL')
  await rejectCode(assertPublicHttpUrl('http://localhost/', publicDns), 'PRIVATE_DESTINATION')
  await rejectCode(assertPublicHttpUrl('http://127.0.0.1/', publicDns), 'PRIVATE_DESTINATION')
  await rejectCode(assertPublicHttpUrl('http://[::1]/', publicDns), 'PRIVATE_DESTINATION')
  await rejectCode(assertPublicHttpUrl('http://10.0.0.5/', publicDns), 'PRIVATE_DESTINATION')
  await rejectCode(assertPublicHttpUrl('https://private.example/', async () => ['192.168.1.20']), 'PRIVATE_DESTINATION')
})

test('scraper validates every redirect and limits response size', async () => {
  let calls = 0
  await rejectCode(fetchPublicHtml('https://public.example/', {
    resolveDns: async (host, type) => {
      if (host === 'public.example') return type === 'A' ? ['93.184.216.34'] : []
      return type === 'A' ? ['127.0.0.1'] : []
    },
    fetchImpl: async () => {
      calls += 1
      return new Response(null, { status: 302, headers: { location: 'http://private.example/' } })
    },
  }), 'PRIVATE_DESTINATION')
  assert.equal(calls, 1)

  await rejectCode(fetchPublicHtml('https://large.example/', {
    resolveDns: publicDns,
    fetchImpl: async () => new Response('', { headers: { 'content-type': 'text/html', 'content-length': String(3 * 1024 * 1024) } }),
  }), 'RESPONSE_TOO_LARGE')
})

test('scraper source requires authenticated user and avoids sensitive URL logging', async () => {
  const scraper = await source('supabase/functions/ap-link-scraper/index.ts')
  assert.match(scraper, /authClient\.auth\.getUser\(token\)/)
  assert.match(scraper, /fetchPublicHtml\(rawUrl\)/)
  assert.match(scraper, /sanitizeUrlForLog\(rawUrl\)/)
  assert.doesNotMatch(scraper, /Scraping URL:/)
  assert.equal(sanitizeUrlForLog('https://news.example/a?token=secret#fragment'), 'news.example/a')
})

test('content production enforces admin JWT tenant authorization and separates the internal worker', async () => {
  const content = await source('supabase/functions/ap-content-production/index.ts')
  assert.match(content, /isTrustedInternalRequest\(req\)/)
  assert.match(content, /requireActiveOperator\(req, createAdminClient\(\), \["admin"\]\)/)
  assert.match(content, /authorizeOperationalTenant\(/)
  assert.match(content, /query = query\.eq\("cliente_id", authorizedClienteId\)/)
  assert.match(content, /TENANT_FORBIDDEN/)
  assert.match(content, /NEWS_NOT_FOUND/)
})

test('editorial administration and publisher require the intended authority boundary', async () => {
  for (const path of [
    'supabase/functions/ap-editorial-settings/index.ts',
    'supabase/functions/ap-editorial-prompt/index.ts',
    'supabase/functions/ap-editorial-rag-upload/index.ts',
    'supabase/functions/ap-editorial-test/index.ts',
  ]) {
    assert.match(await source(path), /requireEditorialAdmin\(req, sbAdmin, clienteId\)|requireEditorialAdmin\(req, sbAdmin, FIXED_CLIENT_ID\)/)
  }
  const publisher = await source('supabase/functions/ap-instagram-publisher/index.ts')
  assert.match(publisher, /isTrustedInternalRequest\(req\)/)
  assert.match(publisher, /INTERNAL_WORKER_AUTH_REQUIRED/)
  assert.match(publisher, /INVALID_NEWS_TENANT/)
})

test('cron migration requires a Vault secret and changes no candidate_news data', async () => {
  const migration = await source('supabase/migrations/20260817003000_harden_internal_autopublisher_workers.sql')
  assert.match(migration, /ap_internal_worker_secret/)
  assert.match(migration, /cron\.alter_job/)
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|INSERT)\s+ap\.candidate_news\b/i)
})
