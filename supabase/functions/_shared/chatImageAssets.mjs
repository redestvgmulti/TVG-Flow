import { UUID_PATTERN } from "./chatAuth.mjs";
import { CHAT_IMAGE_SIGNED_URL_SECONDS } from "./imageValidation.mjs";

export const CHAT_IMAGE_BUCKET = "chat-private-images";

function requireUuid(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new Error("IMAGE_STORAGE_ID_INVALID");
  return value;
}

export function buildImageStoragePath({ clienteId, userId, conversationId, runId, kind, assetId, extension }) {
  const prefix = [clienteId, userId, conversationId, runId].map(requireUuid).join("/");
  if (kind === "original" && ["png", "jpg", "webp"].includes(extension)) return `${prefix}/original.${extension}`;
  if (kind === "result" && extension === "png") return `${prefix}/result-${requireUuid(assetId)}.png`;
  throw new Error("IMAGE_STORAGE_PATH_INVALID");
}

export async function signImageAsset(storage, asset, expiresIn = CHAT_IMAGE_SIGNED_URL_SECONDS) {
  const bucket = storage.from(CHAT_IMAGE_BUCKET);
  const fileName = asset.kind === "result" ? `flowos-imagem-tratada-${asset.id}.png` : `flowos-imagem-original-${asset.id}.${asset.file_extension}`;
  const [preview, download] = await Promise.all([
    bucket.createSignedUrl(asset.storage_path, expiresIn),
    bucket.createSignedUrl(asset.storage_path, expiresIn, { download: fileName }),
  ]);
  if (preview.error || download.error || !preview.data?.signedUrl || !download.data?.signedUrl) {
    throw new Error("IMAGE_SIGNED_URL_FAILED");
  }
  return {
    id: asset.id,
    kind: asset.kind,
    mime_type: asset.mime_type,
    width: asset.width,
    height: asset.height,
    byte_size: asset.byte_size,
    preview_url: preview.data.signedUrl,
    download_url: download.data.signedUrl,
    expires_in: expiresIn,
  };
}
