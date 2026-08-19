const MAX_REDIRECTS = 3
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 12_000

export class SafeLinkFetchError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SafeLinkFetchError'
    this.code = code
  }
}

const blockedHostname = (hostname) => {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === 'localhost' || host.endsWith('.localhost') ||
    host === 'metadata.google.internal' || host.endsWith('.internal')
}

function parseIpv4(value) {
  const parts = value.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null
  const numbers = parts.map(Number)
  return numbers.some((part) => part > 255) ? null : numbers
}

function parseIpv6(value) {
  let input = value.toLowerCase().replace(/^\[|\]$/g, '').split('%', 1)[0]
  if (!input.includes(':')) return null
  if (input.includes('.')) return null
  const halves = input.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null
  const parts = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right]
  if (parts.length !== 8) return null
  return parts.reduce((result, part) => (result << 16n) | BigInt(`0x${part}`), 0n)
}

function ipv6InCidr(value, base, prefix) {
  const shift = 128n - BigInt(prefix)
  return (value >> shift) === (base >> shift)
}

const IPV6_BLOCKS = [
  [0x0n, 96], // IPv4-compatible and other reserved low addresses
  [0x00000000000000000000ffff00000000n, 96], // IPv4-mapped
  [0x0064ff9b000000000000000000000000n, 96], // NAT64 well-known prefix
  [0x0064ff9b000100000000000000000000n, 48], // NAT64 local-use prefix
  [0x01000000000000000000000000000000n, 64], // discard-only
  [0x20010000000000000000000000000000n, 23], // IETF special-purpose assignments
  [0x20010db8000000000000000000000000n, 32], // documentation
  [0x20020000000000000000000000000000n, 16], // 6to4
  [0xfc000000000000000000000000000000n, 7], // unique-local
  [0xfe800000000000000000000000000000n, 10], // link-local
  [0xff000000000000000000000000000000n, 8], // multicast
]

export function isBlockedIpAddress(value) {
  const host = value.toLowerCase().replace(/^\[|\]$/g, '')
  const ipv4 = parseIpv4(host)
  if (ipv4) {
    const [a, b] = ipv4
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && ipv4[2] === 113) ||
      a >= 224
  }

  if (!host.includes(':')) return false
  // Reject mixed IPv4/IPv6 spellings and every relevant IANA special-purpose
  // range. Public literal IPv6 remains allowed.
  if (host.includes('.')) return true
  const ipv6 = parseIpv6(host)
  if (ipv6 === null) return true
  return IPV6_BLOCKS.some(([base, prefix]) => ipv6InCidr(ipv6, base, prefix))
}

export function sanitizeUrlForLog(value) {
  try {
    const parsed = new URL(value)
    return `${parsed.hostname}${parsed.pathname.slice(0, 180)}`
  } catch {
    return 'invalid-url'
  }
}

function defaultResolveDns(hostname, recordType) {
  if (!globalThis.Deno?.resolveDns) {
    throw new SafeLinkFetchError('DNS_UNAVAILABLE', 'DNS resolution is unavailable')
  }
  return globalThis.Deno.resolveDns(hostname, recordType)
}

export async function assertPublicHttpUrl(rawUrl, resolveDns = defaultResolveDns) {
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new SafeLinkFetchError('INVALID_URL', 'URL invalida')
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new SafeLinkFetchError('UNSUPPORTED_PROTOCOL', 'Apenas URLs HTTP ou HTTPS sao aceitas')
  }
  if (parsed.username || parsed.password || blockedHostname(parsed.hostname)) {
    throw new SafeLinkFetchError('PRIVATE_DESTINATION', 'O destino informado nao e permitido')
  }
  if (isBlockedIpAddress(parsed.hostname)) {
    throw new SafeLinkFetchError('PRIVATE_DESTINATION', 'O destino informado nao e permitido')
  }
  if (parseIpv4(parsed.hostname) || parsed.hostname.includes(':')) {
    return parsed
  }

  const records = []
  for (const type of ['A', 'AAAA']) {
    try {
      const result = await resolveDns(parsed.hostname, type)
      records.push(...(Array.isArray(result) ? result : []))
    } catch (error) {
      if (error instanceof SafeLinkFetchError) throw error
      // A hostname may legitimately have only A or only AAAA records.
    }
  }
  if (!records.length) {
    throw new SafeLinkFetchError('DNS_LOOKUP_FAILED', 'Nao foi possivel validar o destino da URL')
  }
  if (records.some((record) => isBlockedIpAddress(String(record)))) {
    throw new SafeLinkFetchError('PRIVATE_DESTINATION', 'O destino informado nao e permitido')
  }
  return parsed
}

async function readTextWithinLimit(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > maxBytes) {
    throw new SafeLinkFetchError('RESPONSE_TOO_LARGE', 'A pagina excede o tamanho maximo permitido')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new SafeLinkFetchError('RESPONSE_TOO_LARGE', 'A pagina excede o tamanho maximo permitido')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return new TextDecoder().decode(concatChunks(chunks, total))
}

function concatChunks(chunks, total) {
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export async function fetchPublicHtml(rawUrl, options = {}) {
  const fetchImpl = options.fetchImpl || fetch
  const resolveDns = options.resolveDns || defaultResolveDns
  const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS
  const maxBytes = options.maxBytes || MAX_RESPONSE_BYTES
  let currentUrl = rawUrl

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const parsed = await assertPublicHttpUrl(currentUrl, resolveDns)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetchImpl(parsed, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'TVG-Flow-Link-Preview/1.0 (+https://tvgflow.com.br)',
          Accept: 'text/html,application/xhtml+xml;q=0.9',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7',
        },
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new SafeLinkFetchError('REQUEST_TIMEOUT', 'Tempo limite ao acessar a URL')
      }
      throw new SafeLinkFetchError('FETCH_FAILED', 'Nao foi possivel acessar a URL')
    } finally {
      clearTimeout(timeout)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new SafeLinkFetchError('INVALID_REDIRECT', 'Redirect sem destino valido')
      if (redirectCount === MAX_REDIRECTS) {
        throw new SafeLinkFetchError('TOO_MANY_REDIRECTS', 'Limite de redirects excedido')
      }
      currentUrl = new URL(location, parsed).toString()
      continue
    }
    if (!response.ok) {
      throw new SafeLinkFetchError('UPSTREAM_HTTP_ERROR', `Falha ao acessar o link (HTTP ${response.status})`)
    }

    const contentType = response.headers.get('content-type') || ''
    if (contentType && !/^text\/html\b|^application\/xhtml\+xml\b/i.test(contentType)) {
      throw new SafeLinkFetchError('UNSUPPORTED_CONTENT_TYPE', 'A URL nao retornou uma pagina HTML')
    }
    const html = await readTextWithinLimit(response, maxBytes)
    return { html, finalUrl: parsed.toString() }
  }

  throw new SafeLinkFetchError('TOO_MANY_REDIRECTS', 'Limite de redirects excedido')
}

export const SAFE_LINK_FETCH_LIMITS = { MAX_REDIRECTS, MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS }
