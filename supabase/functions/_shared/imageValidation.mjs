export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_IMAGE_MAX_EDGE = 8192;
export const CHAT_IMAGE_MAX_PIXELS = 25_000_000;
export const CHAT_IMAGE_SIGNED_URL_SECONDS = 300;

const MIME_EXTENSIONS = Object.freeze({
  "image/png": new Set(["png"]),
  "image/jpeg": new Set(["jpg", "jpeg"]),
  "image/webp": new Set(["webp"]),
});

export class ImageValidationError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "ImageValidationError";
    this.code = code;
    this.status = status;
  }
}

function extensionOf(fileName) {
  const match = String(fileName ?? "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function u16be(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u24le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function u32be(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function inspectPng(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
  return { mimeType: "image/png", extension: "png", width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function inspectJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (sofMarkers.has(marker) && length >= 7) {
      return {
        mimeType: "image/jpeg",
        extension: "jpg",
        height: u16be(bytes, offset + 3),
        width: u16be(bytes, offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

function inspectWebp(bytes) {
  if (bytes.length < 30 || new TextDecoder().decode(bytes.slice(0, 4)) !== "RIFF" || new TextDecoder().decode(bytes.slice(8, 12)) !== "WEBP") return null;
  const chunk = new TextDecoder().decode(bytes.slice(12, 16));
  if (chunk === "VP8X") {
    return { mimeType: "image/webp", extension: "webp", width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
  }
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      mimeType: "image/webp",
      extension: "webp",
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
    return { mimeType: "image/webp", extension: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function validateImageBytes({ bytes, declaredMime, fileName, maximumBytes = CHAT_IMAGE_MAX_BYTES }) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24) throw new ImageValidationError("IMAGE_FILE_INVALID");
  if (bytes.length > maximumBytes) throw new ImageValidationError("IMAGE_FILE_TOO_LARGE", 413);
  const detected = inspectPng(bytes) || inspectJpeg(bytes) || inspectWebp(bytes);
  if (!detected) throw new ImageValidationError("IMAGE_FORMAT_UNSUPPORTED", 415);
  const extension = extensionOf(fileName);
  if (!MIME_EXTENSIONS[detected.mimeType]?.has(extension) || declaredMime?.toLowerCase() !== detected.mimeType) {
    throw new ImageValidationError("IMAGE_TYPE_MISMATCH", 415);
  }
  if (
    detected.width < 64 || detected.height < 64 ||
    detected.width > CHAT_IMAGE_MAX_EDGE || detected.height > CHAT_IMAGE_MAX_EDGE ||
    detected.width * detected.height > CHAT_IMAGE_MAX_PIXELS
  ) {
    throw new ImageValidationError("IMAGE_DIMENSIONS_INVALID", 422);
  }
  return { ...detected, byteSize: bytes.length };
}

export async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
