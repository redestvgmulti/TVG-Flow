import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import {
  parsePngHeader,
  isApng,
  validatePngInput,
  computeTargetDimensions,
  shrinkDimensions,
  formatBytes,
  PngValidationError,
  MAX_INPUT_BYTES,
  MAX_OUTPUT_WIDTH,
} from '../../src/services/seloPngNormalizer.js'

// --- Minimal PNG byte fixtures (enough for the pre-decode pure helpers) --------
function u32(n) { return Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]) }
function chunk(type, data) {
  return Buffer.concat([u32(data.length), Buffer.from(type, 'ascii'), data, u32(0)]) // crc unused by parser
}
function buildPng({ width = 100, height = 50, colorType = 6, apng = false } = {}) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = chunk('IHDR', Buffer.concat([u32(width), u32(height), Buffer.from([8, colorType, 0, 0, 0])]))
  const parts = [sig, ihdr]
  if (apng) parts.push(chunk('acTL', Buffer.concat([u32(2), u32(0)])))
  parts.push(chunk('IDAT', Buffer.from([0, 1, 2, 3])), chunk('IEND', Buffer.alloc(0)))
  return new Uint8Array(Buffer.concat(parts))
}

// --- Validation ---------------------------------------------------------------
test('a real transparent PNG (color type 6) parses its dimensions and alpha type', () => {
  const header = parsePngHeader(buildPng({ width: 1230, height: 464, colorType: 6 }))
  assert.deepEqual(header, { width: 1230, height: 464, bitDepth: 8, colorType: 6 })
})

test('a JPG renamed to .png (no PNG signature) is rejected', () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  assert.throws(() => parsePngHeader(jpg), err => err instanceof PngValidationError && err.code === 'NOT_PNG')
})

test('a truncated PNG is rejected as corrupted', () => {
  assert.throws(() => parsePngHeader(buildPng().slice(0, 20)), err => err.code === 'CORRUPTED')
})

test('an empty file is rejected', () => {
  assert.throws(() => validatePngInput({ bytes: new Uint8Array(0), byteLength: 0 }), err => err.code === 'EMPTY')
})

test('a file above 15 MB is rejected before decoding', () => {
  assert.throws(
    () => validatePngInput({ bytes: buildPng(), byteLength: MAX_INPUT_BYTES + 1 }),
    err => err.code === 'TOO_LARGE',
  )
})

test('excessive dimensions (decompression-bomb guard) are rejected', () => {
  assert.throws(
    () => validatePngInput({ bytes: buildPng({ width: 15000, height: 15000 }) }),
    err => err.code === 'DIMENSIONS_EXCESSIVE',
  )
})

test('an animated PNG (acTL before IDAT) is detected and rejected', () => {
  assert.equal(isApng(buildPng({ apng: true })), true)
  assert.equal(isApng(buildPng({ apng: false })), false)
  assert.throws(() => validatePngInput({ bytes: buildPng({ apng: true }) }), err => err.code === 'APNG_UNSUPPORTED')
})

test('a valid in-range PNG passes validation and returns its header', () => {
  const header = validatePngInput({ bytes: buildPng({ width: 800, height: 300 }), byteLength: 4 * 1024 * 1024 })
  assert.equal(header.width, 800)
  assert.equal(header.height, 300)
})

// --- Resizing -----------------------------------------------------------------
test('a 5000px-wide image is capped at 2000px with the aspect ratio preserved', () => {
  const target = computeTargetDimensions(5000, 1887)
  assert.equal(target.width, MAX_OUTPUT_WIDTH)
  assert.equal(target.resized, true)
  assert.equal(target.height, 755) // round(1887 * 2000/5000)
  const before = 5000 / 1887
  const after = target.width / target.height
  assert.ok(Math.abs(before - after) < 0.01, 'aspect ratio drifted')
})

test('an image already within the cap is never upscaled', () => {
  assert.deepEqual(computeTargetDimensions(1230, 464), { width: 1230, height: 464, resized: false })
  assert.deepEqual(computeTargetDimensions(600, 240), { width: 600, height: 240, resized: false })
})

test('progressive shrink reduces both sides proportionally', () => {
  const next = shrinkDimensions(2000, 755)
  assert.equal(next.width, 1700) // round(2000 * 0.85)
  assert.equal(next.height, 642) // round(755 * 0.85)
  assert.ok(next.width >= 1 && next.height >= 1)
})

test('formatBytes renders human sizes', () => {
  assert.equal(formatBytes(640 * 1024), '640 KB')
  assert.equal(formatBytes(8.4 * 1024 * 1024), '8.4 MB')
  assert.equal(formatBytes(512), '512 B')
})
