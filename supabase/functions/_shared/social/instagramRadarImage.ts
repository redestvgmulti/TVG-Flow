import {
  assertImageSignature,
  fetchPublicBytes,
} from "../safeEgressFetcher.mjs";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 10_000;
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
];
const META_IMAGE_HOST_SUFFIXES = [
  ".cdninstagram.com",
  ".fbcdn.net",
  ".fbsbx.com",
];

type StorageBucket = {
  upload: (
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: boolean },
  ) => Promise<{ error: unknown | null }>;
  getPublicUrl: (path: string) => { data: { publicUrl: string } };
};

export type InstagramRadarImageStorage = {
  from: (bucket: "ap-images") => StorageBucket;
};

export type ArchiveInstagramRadarImageInput = {
  storage: InstagramRadarImageStorage;
  clienteId: string;
  sourceId: string;
  externalId: string;
  thumbnailUrl: string | null;
  fetchImpl?: typeof fetch;
  resolveDns?: (hostname: string, recordType: string) => Promise<string[]>;
};

function isExpectedMetaImageUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password &&
      META_IMAGE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Creates a stable, public app URL from an official Graph media thumbnail.
 * Fetch and storage failures intentionally return null: image enrichment must
 * never make the canonical news ingestion fail.
 */
export async function archiveInstagramRadarImage(
  input: ArchiveInstagramRadarImageInput,
): Promise<string | null> {
  if (!input.thumbnailUrl || !isExpectedMetaImageUrl(input.thumbnailUrl)) {
    return null;
  }
  try {
    const image = await fetchPublicBytes(input.thumbnailUrl, {
      fetchImpl: input.fetchImpl,
      resolveDns: input.resolveDns,
      maxBytes: MAX_IMAGE_BYTES,
      timeoutMs: IMAGE_TIMEOUT_MS,
      allowedContentTypes: ALLOWED_IMAGE_TYPES,
    });
    const detected = assertImageSignature(image.bytes, image.contentType);
    const imageId = await sha256(input.externalId);
    const path =
      `radar/instagram/${input.clienteId}/${input.sourceId}/${imageId}.${detected.extension}`;
    const bucket = input.storage.from("ap-images");
    const { error } = await bucket.upload(path, image.bytes, {
      contentType: detected.contentType,
      upsert: true,
    });
    if (error) return null;
    return bucket.getPublicUrl(path).data.publicUrl || null;
  } catch {
    return null;
  }
}
