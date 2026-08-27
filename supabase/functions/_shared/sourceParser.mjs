const TRACKING_KEYS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid',
])

const NON_ARTICLE_PATHS = [
  /^\/$/,
  /\/(?:tag|tags|category|categorias?|author|autores?|busca|search|login|contato|sobre)(?:\/|$)/i,
  /\/(?:feed|rss|sitemap)(?:[./]|$)/i,
  /\.(?:jpg|jpeg|png|gif|webp|svg|pdf|xml|zip)(?:$|\?)/i,
]

export function decodeXml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
}

export function stripHtml(value = '') {
  return decodeXml(String(value))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeArticleUrl(rawUrl, baseUrl) {
  try {
    const url = new URL(rawUrl, baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_KEYS.has(key.toLowerCase())) url.searchParams.delete(key)
    }
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    url.hostname = url.hostname.toLowerCase()
    return url.toString()
  } catch {
    return null
  }
}

function tagValue(block, names) {
  for (const name of names) {
    const escaped = name.replace(':', '\\:')
    const match = block.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'))
    if (match?.[1]) return stripHtml(match[1])
  }
  return ''
}

function attrValue(tag, name) {
  return tag?.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || ''
}

function firstTag(document, tagName) {
  return document.match(new RegExp(`<${tagName}\\b[^>]*>`, 'i'))?.[0] || ''
}

function metaValue(html, key, values) {
  const tags = html.match(/<meta\b[^>]*>/gi) || []
  for (const tag of tags) {
    const keyValue = attrValue(tag, key).toLowerCase()
    if (!values.includes(keyValue)) continue
    const content = attrValue(tag, 'content')
    if (content) return decodeXml(content).trim()
  }
  return ''
}

function linkValue(html, rel) {
  const tags = html.match(/<link\b[^>]*>/gi) || []
  for (const tag of tags) {
    const relValue = attrValue(tag, 'rel').toLowerCase().split(/\s+/)
    if (relValue.includes(rel)) return attrValue(tag, 'href')
  }
  return ''
}

function jsonLdObjects(html) {
  const scripts = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || []
  const result = []
  for (const script of scripts) {
    const raw = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '').trim()
    try {
      const parsed = JSON.parse(decodeXml(raw))
      result.push(...(Array.isArray(parsed) ? parsed : [parsed]))
    } catch {
      // Invalid publisher JSON-LD is ignored; HTML discovery remains available.
    }
  }
  return result
}

function flattenJsonLd(value, output = []) {
  if (!value || typeof value !== 'object') return output
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, output)
    return output
  }
  output.push(value)
  if (Array.isArray(value['@graph'])) flattenJsonLd(value['@graph'], output)
  if (value.itemListElement) flattenJsonLd(value.itemListElement, output)
  if (value.item) flattenJsonLd(value.item, output)
  return output
}

function absoluteUrl(value, baseUrl) {
  return normalizeArticleUrl(value, baseUrl)
}

function validPublishedAt(value) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export function detectDocumentType(text, contentType = '') {
  const sample = String(text || '').trim().slice(0, 1000).toLowerCase()
  if (sample.includes('<urlset') || sample.includes('<sitemapindex')) return 'sitemap'
  if (sample.includes('<feed') || contentType.includes('atom')) return 'atom'
  if (sample.includes('<rss') || sample.includes('<rdf:rdf') || sample.includes('<channel')) return 'rss'
  if (contentType.includes('html') || sample.includes('<html') || sample.includes('<!doctype html')) return 'website'
  return 'unknown'
}

export function parseFeedDocument(xml, baseUrl) {
  const isAtom = /<feed\b/i.test(xml) || /<entry\b/i.test(xml)
  const blocks = isAtom
    ? (xml.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) || [])
    : (xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [])

  return blocks.map(block => {
    const linkTag = firstTag(block, 'link')
    const rawLink = isAtom
      ? (attrValue(linkTag, 'href') || tagValue(block, ['link']))
      : (tagValue(block, ['link']) || attrValue(linkTag, 'href'))
    const url = absoluteUrl(rawLink, baseUrl)
    const title = tagValue(block, ['title'])
    if (!url || !title) return null
    const description = tagValue(block, ['description', 'summary', 'content', 'content:encoded'])
    const enclosure = block.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*>/i)?.[0] || ''
    return {
      url,
      canonicalUrl: url,
      title,
      excerpt: description,
      content: description,
      imageUrl: absoluteUrl(attrValue(enclosure, 'url'), baseUrl),
      publishedAt: validPublishedAt(tagValue(block, ['pubDate', 'published', 'updated', 'dc:date'])),
    }
  }).filter(Boolean)
}

export function parseSitemapDocument(xml, baseUrl) {
  const urls = []
  const blocks = xml.match(/<(?:url|sitemap)\b[^>]*>[\s\S]*?<\/(?:url|sitemap)>/gi) || []
  for (const block of blocks) {
    const url = absoluteUrl(tagValue(block, ['loc']), baseUrl)
    if (!url) continue
    urls.push({
      url,
      canonicalUrl: url,
      title: '',
      excerpt: '',
      content: '',
      imageUrl: null,
      publishedAt: validPublishedAt(tagValue(block, ['lastmod'])),
      sitemap: /<sitemap\b/i.test(block),
    })
  }
  return urls
}

export function discoverFeedUrls(html, baseUrl) {
  const urls = []
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = attrValue(tag, 'rel').toLowerCase()
    const type = attrValue(tag, 'type').toLowerCase()
    if (!rel.split(/\s+/).includes('alternate')) continue
    if (!/(?:rss|atom|xml)/.test(type)) continue
    const url = absoluteUrl(attrValue(tag, 'href'), baseUrl)
    if (url) urls.push(url)
  }
  return [...new Set(urls)]
}

function looksLikeArticle(url, rootUrl) {
  if (!url) return false
  const parsed = new URL(url)
  const root = new URL(rootUrl)
  if (parsed.hostname !== root.hostname) return false
  if (NON_ARTICLE_PATHS.some(pattern => pattern.test(`${parsed.pathname}${parsed.search}`))) return false
  const segments = parsed.pathname.split('/').filter(Boolean)
  return segments.length >= 1 && (segments.length >= 2 || /[-_]|\d{4}|\d{2}/.test(segments[0]))
}

export function discoverArticleUrls(html, baseUrl, limit = 30) {
  const scored = new Map()
  const add = (rawUrl, score, title = '') => {
    const url = absoluteUrl(rawUrl, baseUrl)
    if (!looksLikeArticle(url, baseUrl)) return
    const current = scored.get(url)
    if (!current || current.score < score) scored.set(url, { url, score, title: stripHtml(title) })
  }

  for (const object of flattenJsonLd(jsonLdObjects(html))) {
    const type = String(object['@type'] || '').toLowerCase()
    const rawUrl = object.url || object['@id'] || object.mainEntityOfPage?.['@id'] || object.item?.url
    const title = object.headline || object.name || object.item?.name || ''
    if (/(?:newsarticle|article|reportage|listitem)/.test(type)) add(rawUrl, 100, title)
  }

  const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []
  for (const anchor of anchors) {
    const opening = anchor.match(/^<a\b[^>]*>/i)?.[0] || ''
    const href = attrValue(opening, 'href')
    const title = attrValue(opening, 'title') || stripHtml(anchor)
    const context = opening.toLowerCase()
    let score = 10
    if (/(?:article|noticia|news|post|headline|materia)/.test(context)) score += 30
    if (title.length >= 20) score += 10
    if (/\/\d{4}\/\d{1,2}\//.test(href)) score += 20
    add(href, score, title)
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, limit)
    .map(item => ({
      url: item.url,
      canonicalUrl: item.url,
      title: item.title,
      excerpt: '',
      content: '',
      imageUrl: null,
      publishedAt: null,
    }))
}

export function parseArticleHtml(html, pageUrl) {
  const objects = flattenJsonLd(jsonLdObjects(html))
  const article = objects.find(object => /(?:newsarticle|article|reportage)/i.test(String(object['@type'] || ''))) || {}
  const canonical = absoluteUrl(
    linkValue(html, 'canonical') || article.mainEntityOfPage?.['@id'] || article.url || pageUrl,
    pageUrl,
  ) || pageUrl
  const rawTitle = metaValue(html, 'property', ['og:title'])
    || metaValue(html, 'name', ['twitter:title'])
    || article.headline
    || tagValue(html, ['h1', 'title'])
  const excerpt = metaValue(html, 'property', ['og:description'])
    || metaValue(html, 'name', ['description', 'twitter:description'])
    || article.description
    || ''
  const paragraphs = (html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || [])
    .map(stripHtml)
    .filter(text => text.length >= 35)
  const content = paragraphs.join('\n\n') || stripHtml(article.articleBody || '') || excerpt
  const imageValue = metaValue(html, 'property', ['og:image', 'og:image:url'])
    || metaValue(html, 'name', ['twitter:image'])
    || (typeof article.image === 'string' ? article.image : article.image?.url)
  const published = metaValue(html, 'property', ['article:published_time'])
    || article.datePublished
    || attrValue(html.match(/<time\b[^>]*datetime\s*=\s*["'][^"']+["'][^>]*>/i)?.[0] || '', 'datetime')

  return {
    url: pageUrl,
    canonicalUrl: canonical,
    title: stripHtml(rawTitle),
    excerpt: stripHtml(excerpt),
    content: content.trim(),
    imageUrl: absoluteUrl(imageValue, pageUrl),
    publishedAt: validPublishedAt(published),
  }
}

export function uniqueItems(items, limit = 10) {
  const seen = new Set()
  const result = []
  for (const item of items) {
    const key = normalizeArticleUrl(item.canonicalUrl || item.url, item.url)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push({ ...item, url: item.url || key, canonicalUrl: key })
    if (result.length >= limit) break
  }
  return result
}
