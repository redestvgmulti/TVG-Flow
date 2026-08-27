import { fetchPublicText, SafeEgressFetchError } from './safeEgressFetcher.mjs'
import {
  detectDocumentType,
  discoverArticleUrls,
  discoverFeedUrls,
  parseArticleHtml,
  parseFeedDocument,
  parseSitemapDocument,
  uniqueItems,
} from './sourceParser.mjs'

const DOCUMENT_MAX_BYTES = 4 * 1024 * 1024
const PAGE_MAX_BYTES = 3 * 1024 * 1024
const FETCH_TIMEOUT_MS = 12_000
const DOCUMENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'application/rss+xml',
  'application/atom+xml',
  'application/xml',
  'text/xml',
  'text/plain',
]

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; TVGFlowCollector/2.0; +https://tvg.com.br)',
  Accept: 'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.5',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.6',
}

export class SourceCollectionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SourceCollectionError'
    this.code = code
  }
}

async function fetchDocument(url, maxBytes = DOCUMENT_MAX_BYTES) {
  return fetchPublicText(url, {
    maxBytes,
    timeoutMs: FETCH_TIMEOUT_MS,
    maxRedirects: 3,
    allowedContentTypes: DOCUMENT_TYPES,
    headers: COMMON_HEADERS,
  })
}

async function feedFromHtml(html, pageUrl) {
  for (const feedUrl of discoverFeedUrls(html, pageUrl).slice(0, 2)) {
    try {
      const feed = await fetchDocument(feedUrl)
      const type = detectDocumentType(feed.text, feed.contentType)
      if (!['rss', 'atom'].includes(type)) continue
      const items = parseFeedDocument(feed.text, feed.finalUrl)
      if (items.length) return { type, items, discoveryUrl: feed.finalUrl }
    } catch {
      // A broken advertised feed must not prevent the website fallback.
    }
  }
  return null
}

async function itemsFromSitemap(document, rootUrl) {
  const initial = parseSitemapDocument(document, rootUrl)
  const sitemapChildren = initial.filter(item => item.sitemap).slice(0, 3)
  if (!sitemapChildren.length) return initial

  const children = (await Promise.all(sitemapChildren.map(async item => {
    try {
      const nested = await fetchDocument(item.url)
      return parseSitemapDocument(nested.text, nested.finalUrl).filter(entry => !entry.sitemap)
    } catch {
      // Other sitemap children can still produce a useful bounded result.
      return []
    }
  }))).flat()
  return children
}

async function enrichItem(item) {
  try {
    const page = await fetchDocument(item.url, PAGE_MAX_BYTES)
    if (detectDocumentType(page.text, page.contentType) !== 'website') return item
    const parsed = parseArticleHtml(page.text, page.finalUrl)
    return {
      ...item,
      ...parsed,
      title: parsed.title || item.title,
      excerpt: parsed.excerpt || item.excerpt,
      content: parsed.content || item.content,
      imageUrl: parsed.imageUrl || item.imageUrl,
      publishedAt: parsed.publishedAt || item.publishedAt,
    }
  } catch {
    return item
  }
}

export async function collectSource(source, options = {}) {
  const maxItems = Math.min(Math.max(Number(options.maxItems) || 10, 1), 25)
  let sourceUrl = source.url
  if (sourceUrl.includes('instagram.com')) {
    const match = sourceUrl.match(/instagram\.com\/([^\\/?#]+)/i)
    if (match?.[1]) sourceUrl = `https://rsshub.anyat.icu/instagram/user/${match[1]}`
  }

  let root
  try {
    root = await fetchDocument(sourceUrl)
  } catch (error) {
    if (error instanceof SafeEgressFetchError) {
      throw new SourceCollectionError(error.code, error.message)
    }
    throw error
  }

  const detected = detectDocumentType(root.text, root.contentType)
  let detectedType = detected
  let items = []
  let discoveryUrl = root.finalUrl

  if (detected === 'rss' || detected === 'atom') {
    items = parseFeedDocument(root.text, root.finalUrl)
  } else if (detected === 'sitemap') {
    items = await itemsFromSitemap(root.text, root.finalUrl)
  } else if (detected === 'website') {
    const advertisedFeed = await feedFromHtml(root.text, root.finalUrl)
    if (advertisedFeed) {
      detectedType = advertisedFeed.type
      items = advertisedFeed.items
      discoveryUrl = advertisedFeed.discoveryUrl
    } else {
      items = discoverArticleUrls(root.text, root.finalUrl, Math.max(maxItems * 3, 20))
    }
  } else {
    throw new SourceCollectionError('UNSUPPORTED_SOURCE_DOCUMENT', 'Source did not return HTML, RSS, Atom or sitemap content')
  }

  if (!items.length) {
    throw new SourceCollectionError('NO_ARTICLES_DISCOVERED', 'No article links were discovered at this source')
  }

  const candidates = uniqueItems(items, maxItems)
  const enriched = []
  const concurrency = 4
  for (let offset = 0; offset < candidates.length; offset += concurrency) {
    const batch = candidates.slice(offset, offset + concurrency)
    enriched.push(...await Promise.all(batch.map(enrichItem)))
  }

  const valid = uniqueItems(enriched, maxItems).filter(item => item.title?.trim().length >= 3)
  if (!valid.length) {
    throw new SourceCollectionError('NO_VALID_ARTICLES', 'Discovered links did not expose valid article metadata')
  }

  return {
    detectedType,
    discoveryUrl,
    items: valid,
  }
}

export const SOURCE_COLLECTOR_LIMITS = {
  documentMaxBytes: DOCUMENT_MAX_BYTES,
  pageMaxBytes: PAGE_MAX_BYTES,
  timeoutMs: FETCH_TIMEOUT_MS,
  maxRedirects: 3,
}
