import assert from 'node:assert/strict'
import test from 'node:test'
import {
  detectDocumentType,
  discoverArticleUrls,
  discoverFeedUrls,
  normalizeArticleUrl,
  parseArticleHtml,
  parseFeedDocument,
  parseSitemapDocument,
} from '../supabase/functions/_shared/sourceParser.mjs'

test('detects and parses RSS without requiring an RSS URL suffix', () => {
  const xml = `<?xml version="1.0"?><rss><channel><item>
    <title><![CDATA[Notícia principal da cidade]]></title>
    <link>https://jornal.example/noticias/principal?utm_source=feed</link>
    <description><![CDATA[<p>Resumo factual da notícia.</p>]]></description>
    <pubDate>Wed, 26 Aug 2026 14:00:00 GMT</pubDate>
  </item></channel></rss>`
  assert.equal(detectDocumentType(xml, 'application/xml'), 'rss')
  const [item] = parseFeedDocument(xml, 'https://jornal.example/qualquer-endereco')
  assert.equal(item.title, 'Notícia principal da cidade')
  assert.equal(item.canonicalUrl, 'https://jornal.example/noticias/principal')
  assert.equal(item.excerpt, 'Resumo factual da notícia.')
})

test('discovers an advertised feed and article links from a website homepage', () => {
  const html = `<html><head>
    <link rel="alternate" type="application/rss+xml" href="/feed.xml">
  </head><body>
    <article><a class="headline" href="/politica/2026/noticia-importante">Notícia importante para toda a região</a></article>
    <a href="/categoria/politica">Categoria</a>
  </body></html>`
  assert.equal(detectDocumentType(html, 'text/html'), 'website')
  assert.deepEqual(discoverFeedUrls(html, 'https://portal.example/'), ['https://portal.example/feed.xml'])
  assert.deepEqual(
    discoverArticleUrls(html, 'https://portal.example/').map(item => item.url),
    ['https://portal.example/politica/2026/noticia-importante'],
  )
})

test('parses sitemap entries and article metadata', () => {
  const sitemap = `<urlset><url><loc>https://portal.example/noticias/a</loc><lastmod>2026-08-27</lastmod></url></urlset>`
  const [entry] = parseSitemapDocument(sitemap, 'https://portal.example/sitemap.xml')
  assert.equal(entry.url, 'https://portal.example/noticias/a')
  assert.equal(entry.sitemap, false)

  const article = parseArticleHtml(`<html><head>
    <link rel="canonical" href="https://portal.example/noticias/a?utm_campaign=x">
    <meta property="og:title" content="Título confirmado">
    <meta name="description" content="Resumo confirmado">
    <meta property="article:published_time" content="2026-08-27T08:00:00-03:00">
  </head><body><p>Este é um parágrafo suficientemente longo para ser preservado como conteúdo da matéria.</p></body></html>`, entry.url)
  assert.equal(article.canonicalUrl, 'https://portal.example/noticias/a')
  assert.equal(article.title, 'Título confirmado')
  assert.match(article.content, /parágrafo suficientemente longo/)
})

test('normalizes tracking parameters but preserves editorial query parameters', () => {
  assert.equal(
    normalizeArticleUrl('https://EXAMPLE.com/noticia/?id=10&utm_medium=social#topo'),
    'https://example.com/noticia?id=10',
  )
})
