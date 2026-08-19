import {
  assertPublicHttpUrl,
  SafeLinkFetchError,
} from './safeLinkFetcher.mjs'

const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_TIMEOUT_MS = 12_000

export class SafeEgressFetchError extends Error {
  constructor(code, message, status = null) {
    super(message)
    this.name = 'SafeEgressFetchError'
    this.code = code
    this.status = status
  }
}

function normalizeContentType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase()
}

function concatChunks(chunks, total) {
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function readWithinLimit(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new SafeEgressFetchError('RESPONSE_TOO_LARGE', 'Response exceeds the configured byte limit')
  }
  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new SafeEgressFetchError('RESPONSE_TOO_LARGE', 'Response exceeds the configured byte limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return concatChunks(chunks, total)
}

function isRedirect(status) {
  return status >= 300 && status < 400
}

export async function fetchPublicBytes(rawUrl, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const resolveDns = options.resolveDns
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const allowedContentTypes = new Set(
    (options.allowedContentTypes || []).map(normalizeContentType),
  )
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new SafeEgressFetchError('INVALID_LIMIT', 'A positive byte limit is required')
  }

  let currentUrl = rawUrl
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    let parsed
    try {
      parsed = resolveDns
        ? await assertPublicHttpUrl(currentUrl, resolveDns)
        : await assertPublicHttpUrl(currentUrl)
    } catch (error) {
      if (error instanceof SafeLinkFetchError) {
        throw new SafeEgressFetchError(error.code, error.message)
      }
      throw error
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(parsed, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: options.headers || {},
      })

      if (isRedirect(response.status)) {
        await response.body?.cancel().catch(() => undefined)
        const location = response.headers.get('location')
        if (!location) {
          throw new SafeEgressFetchError('INVALID_REDIRECT', 'Redirect response omitted Location', response.status)
        }
        if (redirectCount === maxRedirects) {
          throw new SafeEgressFetchError('TOO_MANY_REDIRECTS', 'Redirect limit exceeded', response.status)
        }
        currentUrl = new URL(location, parsed).toString()
        continue
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new SafeEgressFetchError('UPSTREAM_HTTP_ERROR', 'Upstream returned an error', response.status)
      }

      const contentType = normalizeContentType(response.headers.get('content-type'))
      if (!contentType || (allowedContentTypes.size && !allowedContentTypes.has(contentType))) {
        await response.body?.cancel().catch(() => undefined)
        throw new SafeEgressFetchError('UNSUPPORTED_CONTENT_TYPE', 'Response MIME is not allowed', response.status)
      }

      const bytes = await readWithinLimit(response, maxBytes)
      return {
        bytes,
        contentType,
        finalUrl: parsed.toString(),
        redirects: redirectCount,
        status: response.status,
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new SafeEgressFetchError('REQUEST_TIMEOUT', 'Request timed out')
      }
      if (error instanceof SafeEgressFetchError) throw error
      throw new SafeEgressFetchError('FETCH_FAILED', 'Public resource could not be fetched')
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new SafeEgressFetchError('TOO_MANY_REDIRECTS', 'Redirect limit exceeded')
}

export async function fetchPublicText(rawUrl, options = {}) {
  const result = await fetchPublicBytes(rawUrl, options)
  return { ...result, text: new TextDecoder().decode(result.bytes) }
}

function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.slice(start, end))
}

export function detectImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' }
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { contentType: 'image/png', extension: 'png' }
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return { contentType: 'image/webp', extension: 'webp' }
  }
  if (bytes.length >= 16 && ascii(bytes, 4, 8) === 'ftyp') {
    const brands = ascii(bytes, 8, Math.min(bytes.length, 64))
    if (brands.includes('avif') || brands.includes('avis')) {
      return { contentType: 'image/avif', extension: 'avif' }
    }
  }
  return null
}

export function assertImageSignature(bytes, declaredContentType) {
  const detected = detectImageType(bytes)
  if (!detected || detected.contentType !== normalizeContentType(declaredContentType)) {
    throw new SafeEgressFetchError('INVALID_IMAGE_SIGNATURE', 'Image signature does not match its declared MIME')
  }
  return detected
}

export const SAFE_EGRESS_LIMITS = {
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
}
