// Selo PNG normalizer. The operator may upload a "reasonably large" transparent
// PNG (up to 15 MB); the browser validates the REAL file, resizes it (contain,
// never upscale, width capped at 2000 px), re-encodes it as PNG preserving the
// alpha channel, and progressively shrinks it until it fits under 5 MB. Only the
// normalized file is ever uploaded, and its SHA-256 is taken over that final PNG.
//
// The pure helpers (signature/IHDR/APNG parsing, dimension math, size guards) are
// exported and unit-tested in Node; the Canvas-based encode runs in the browser.

export const MAX_INPUT_BYTES = 15 * 1024 * 1024
export const MAX_OUTPUT_BYTES = 5 * 1024 * 1024
export const IDEAL_OUTPUT_BYTES = 1 * 1024 * 1024
export const MAX_OUTPUT_WIDTH = 2000
export const RECOMMENDED_WIDTH = 1230
export const RECOMMENDED_HEIGHT = 464
// Decompression-bomb guards, checked from the header BEFORE any decode.
export const MAX_INPUT_DIMENSION = 12000
export const MAX_INPUT_AREA = 40_000_000 // ~40 MP
// Bounded, never-infinite shrink loop when the first encode is still > 5 MB.
export const MAX_COMPRESSION_ATTEMPTS = 6
const SHRINK_FACTOR = 0.85

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export class PngValidationError extends Error {
  constructor(code, message) {
    super(message || code)
    this.name = 'PngValidationError'
    this.code = code
  }
}

export const VALIDATION_MESSAGES = {
  NOT_PNG: 'O arquivo selecionado não é um PNG válido.',
  EMPTY: 'O arquivo selecionado está vazio.',
  TOO_LARGE: 'O PNG deve ter no máximo 15 MB.',
  DIMENSIONS_EXCESSIVE: 'A imagem possui dimensões excessivas.',
  APNG_UNSUPPORTED: 'PNGs animados (APNG) não são suportados.',
  CORRUPTED: 'Não foi possível processar a imagem. O arquivo pode estar corrompido.',
  TOO_HEAVY:
    'Não foi possível reduzir o arquivo para menos de 5 MB sem comprometer a imagem.',
}

function hasPngSignature(bytes) {
  if (bytes.length < PNG_SIGNATURE.length) return false
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

// Reads width/height/colorType/bitDepth from the IHDR chunk without decoding the
// pixel data. Throws PngValidationError for anything that is not a real PNG.
export function parsePngHeader(bytes) {
  if (!hasPngSignature(bytes)) throw new PngValidationError('NOT_PNG')
  // IHDR must be the first chunk: length(4)+"IHDR"(4) starts at offset 8.
  if (bytes.length < 33) throw new PngValidationError('CORRUPTED')
  const type = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
  if (type !== 'IHDR') throw new PngValidationError('NOT_PNG')
  const readU32 = offset =>
    (bytes[offset] << 24 |
      bytes[offset + 1] << 16 |
      bytes[offset + 2] << 8 |
      bytes[offset + 3]) >>> 0
  const width = readU32(16)
  const height = readU32(20)
  const bitDepth = bytes[24]
  const colorType = bytes[25]
  if (width < 1 || height < 1) throw new PngValidationError('CORRUPTED')
  return { width, height, bitDepth, colorType }
}

// APNG is a PNG with an acTL chunk before the first IDAT. Canvas would silently
// flatten it to the first frame, so we reject it instead of misrepresenting it.
export function isApng(bytes) {
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length =
      (bytes[offset] << 24 |
        bytes[offset + 1] << 16 |
        bytes[offset + 2] << 8 |
        bytes[offset + 3]) >>> 0
    const type = String.fromCharCode(
      bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7],
    )
    if (type === 'acTL') return true
    if (type === 'IDAT') return false
    offset += 12 + length // length(4)+type(4)+data(length)+crc(4)
  }
  return false
}

// Full pre-decode validation: real PNG, non-empty, within size + dimension
// limits, not animated. Returns the parsed header on success.
export function validatePngInput({ bytes, byteLength }) {
  const size = byteLength ?? bytes.length
  if (size === 0) throw new PngValidationError('EMPTY')
  if (size > MAX_INPUT_BYTES) throw new PngValidationError('TOO_LARGE')
  const header = parsePngHeader(bytes)
  if (
    header.width > MAX_INPUT_DIMENSION ||
    header.height > MAX_INPUT_DIMENSION ||
    header.width * header.height > MAX_INPUT_AREA
  ) {
    throw new PngValidationError('DIMENSIONS_EXCESSIVE')
  }
  if (isApng(bytes)) throw new PngValidationError('APNG_UNSUPPORTED')
  return header
}

// Contain fit: width is capped at maxWidth, height follows proportionally, and
// images already within the cap are never upscaled.
export function computeTargetDimensions(width, height, maxWidth = MAX_OUTPUT_WIDTH) {
  if (width <= maxWidth) return { width, height, resized: false }
  const scale = maxWidth / width
  return {
    width: maxWidth,
    height: Math.max(1, Math.round(height * scale)),
    resized: true,
  }
}

// Next smaller dimensions for the progressive shrink loop (proportional).
export function shrinkDimensions(width, height, factor = SHRINK_FACTOR) {
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  }
}

function pickCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

async function encodePng(bitmap, width, height) {
  const canvas = pickCanvas(width, height)
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: true })
  // The canvas starts fully transparent and no background is ever painted, so
  // alpha and transparent pixels are preserved through the redraw.
  ctx.clearRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/png' })
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new PngValidationError('CORRUPTED'))), 'image/png')
  })
}

function finalName(originalName) {
  const base = String(originalName || 'selo').replace(/\.[^.]*$/, '')
  return `${base || 'selo'}.png`
}

// Browser entry point. Emits coarse progress via onState and returns the
// normalized File plus original/final metadata. Throws PngValidationError with a
// user-facing message (VALIDATION_MESSAGES) on any unrecoverable problem.
export async function normalizeSeloPng(file, { onState } = {}) {
  const state = value => { if (typeof onState === 'function') onState(value) }
  state('analyzing')

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  // Do not trust file.type / file.name: validate the real bytes.
  const header = validatePngInput({ bytes, byteLength: file.size })

  let bitmap
  try {
    bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/png' }))
  } catch {
    throw new PngValidationError('CORRUPTED')
  }

  try {
    state('optimizing')
    let { width, height } = computeTargetDimensions(bitmap.width, bitmap.height)
    let blob = await encodePng(bitmap, width, height)
    let attempts = 1

    while (blob.size > MAX_OUTPUT_BYTES && attempts < MAX_COMPRESSION_ATTEMPTS) {
      ({ width, height } = shrinkDimensions(width, height))
      blob = await encodePng(bitmap, width, height)
      attempts += 1
    }

    if (blob.size > MAX_OUTPUT_BYTES) throw new PngValidationError('TOO_HEAVY')

    state('ready')
    const normalized = new File([blob], finalName(file.name), { type: 'image/png' })
    return {
      file: normalized,
      original: { width: header.width, height: header.height, bytes: file.size },
      final: { width, height, bytes: blob.size },
      attempts,
    }
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close()
  }
}

// Human-readable byte size for the before/after UI.
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
