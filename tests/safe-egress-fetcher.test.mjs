import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertImageSignature,
  fetchPublicBytes,
  SafeEgressFetchError,
} from '../supabase/functions/_shared/safeEgressFetcher.mjs'

const publicDns = async (_hostname, type) => type === 'A' ? ['93.184.216.34'] : []

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof SafeEgressFetchError)
    assert.equal(error.code, code)
    return true
  })
}

function jpegResponse(headers = {}) {
  return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]), {
    status: 200,
    headers: { 'content-type': 'image/jpeg', ...headers },
  })
}

for (const url of [
  'http://127.0.0.1/image.jpg',
  'http://localhost/image.jpg',
  'http://[::1]/image.jpg',
  'http://[::ffff:7f00:1]/image.jpg',
  'http://[64:ff9b::7f00:1]/image.jpg',
  'http://[100::1]/image.jpg',
  'http://[2001::1]/image.jpg',
  'http://[2002:7f00:1::]/image.jpg',
  'http://10.1.2.3/image.jpg',
  'http://172.16.0.1/image.jpg',
  'http://172.31.255.254/image.jpg',
  'http://192.168.1.1/image.jpg',
  'http://169.254.169.254/latest/meta-data',
  'http://[fd00:ec2::254]/latest/meta-data',
  'http://[fe80::1]/image.jpg',
  'http://metadata.google.internal/computeMetadata/v1/',
  'https://user:password@example.com/image.jpg',
]) {
  test(`blocks prohibited destination ${url}`, async () => {
    await rejectsCode(fetchPublicBytes(url, {
      fetchImpl: async () => jpegResponse(),
      resolveDns: publicDns,
      maxBytes: 1024,
      allowedContentTypes: ['image/jpeg'],
    }), 'PRIVATE_DESTINATION')
  })
}

for (const url of [
  'file:///etc/passwd',
  'ftp://example.com/image.jpg',
  'data:image/png;base64,AA==',
  'javascript:alert(1)',
]) {
  test(`blocks non-HTTP protocol ${url.split(':', 1)[0]}`, async () => {
    await rejectsCode(fetchPublicBytes(url, {
      fetchImpl: async () => jpegResponse(),
      resolveDns: publicDns,
      maxBytes: 1024,
      allowedContentTypes: ['image/jpeg'],
    }), 'UNSUPPORTED_PROTOCOL')
  })
}

test('blocks a public redirect to a private destination before the second fetch', async () => {
  let calls = 0
  await rejectsCode(fetchPublicBytes('https://public.example/image.jpg', {
    resolveDns: publicDns,
    fetchImpl: async () => {
      calls += 1
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } })
    },
    maxBytes: 1024,
    allowedContentTypes: ['image/jpeg'],
  }), 'PRIVATE_DESTINATION')
  assert.equal(calls, 1)
})

test('accepts a valid public HTTPS JPEG', async () => {
  const result = await fetchPublicBytes('https://images.example/news.jpg', {
    resolveDns: publicDns,
    fetchImpl: async () => jpegResponse(),
    maxBytes: 1024,
    allowedContentTypes: ['image/jpeg'],
  })
  assert.equal(result.status, 200)
  assert.equal(result.contentType, 'image/jpeg')
  assert.equal(result.bytes.byteLength, 6)
  assert.deepEqual(assertImageSignature(result.bytes, result.contentType), {
    contentType: 'image/jpeg',
    extension: 'jpg',
  })
})

test('rejects HTML returned by an image endpoint', async () => {
  await rejectsCode(fetchPublicBytes('https://images.example/fake.jpg', {
    resolveDns: publicDns,
    fetchImpl: async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
    maxBytes: 1024,
    allowedContentTypes: ['image/jpeg'],
  }), 'UNSUPPORTED_CONTENT_TYPE')
})

test('rejects an allowed MIME with invalid magic bytes', () => {
  assert.throws(
    () => assertImageSignature(new TextEncoder().encode('<html>'), 'image/jpeg'),
    (error) => error instanceof SafeEgressFetchError && error.code === 'INVALID_IMAGE_SIGNATURE',
  )
})

test('rejects a declared response larger than the limit', async () => {
  await rejectsCode(fetchPublicBytes('https://images.example/huge.jpg', {
    resolveDns: publicDns,
    fetchImpl: async () => jpegResponse({ 'content-length': '2048' }),
    maxBytes: 1024,
    allowedContentTypes: ['image/jpeg'],
  }), 'RESPONSE_TOO_LARGE')
})

test('enforces the limit while streaming without Content-Length', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(700))
      controller.enqueue(new Uint8Array(700))
      controller.close()
    },
  })
  await rejectsCode(fetchPublicBytes('https://images.example/stream.jpg', {
    resolveDns: publicDns,
    fetchImpl: async () => new Response(stream, { headers: { 'content-type': 'image/jpeg' } }),
    maxBytes: 1024,
    allowedContentTypes: ['image/jpeg'],
  }), 'RESPONSE_TOO_LARGE')
})

test('rejects a MIME outside the explicit allowlist', async () => {
  await rejectsCode(fetchPublicBytes('https://images.example/file.json', {
    resolveDns: publicDns,
    fetchImpl: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    maxBytes: 1024,
    allowedContentTypes: ['image/jpeg'],
  }), 'UNSUPPORTED_CONTENT_TYPE')
})

test('rejects excessive redirects', async () => {
  let redirect = 0
  await rejectsCode(fetchPublicBytes('https://public.example/start', {
    resolveDns: publicDns,
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: `https://public.example/redirect-${++redirect}` },
    }),
    maxRedirects: 2,
    maxBytes: 1024,
    allowedContentTypes: ['image/jpeg'],
  }), 'TOO_MANY_REDIRECTS')
})

test('rejects a timed-out request', async () => {
  await rejectsCode(fetchPublicBytes('https://slow.example/image.jpg', {
    resolveDns: publicDns,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    }),
    timeoutMs: 5,
    maxBytes: 1024,
    allowedContentTypes: ['image/jpeg'],
  }), 'REQUEST_TIMEOUT')
})

test('rejects a hostname with no DNS answers', async () => {
  await rejectsCode(fetchPublicBytes('https://missing.example/image.jpg', {
    resolveDns: async () => [],
    fetchImpl: async () => jpegResponse(),
    maxBytes: 1024,
    allowedContentTypes: ['image/jpeg'],
  }), 'DNS_LOOKUP_FAILED')
})

test('rejects when any DNS answer is private', async () => {
  await rejectsCode(fetchPublicBytes('https://mixed.example/image.jpg', {
    resolveDns: async (_hostname, type) => type === 'A'
      ? ['93.184.216.34', '10.0.0.4']
      : [],
    fetchImpl: async () => jpegResponse(),
    maxBytes: 1024,
    allowedContentTypes: ['image/jpeg'],
  }), 'PRIVATE_DESTINATION')
})
