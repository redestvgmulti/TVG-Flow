const MAX_PNG_BYTES = 5 * 1024 * 1024;

export async function sha256(file) {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function uploadImmutablePng({ supabase, file, clienteId, kind, slug }) {
  if (!file || file.type !== 'image/png' || !file.name.toLowerCase().endsWith('.png')) throw new Error('Envie somente arquivos PNG.');
  if (file.size > MAX_PNG_BYTES) throw new Error('O PNG deve ter no máximo 5 MB.');
  const checksum = await sha256(file);
  const safeSlug = String(slug || 'asset').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const path = `${kind}/${clienteId}/${safeSlug}/${checksum}.png`;
  const { error } = await supabase.storage.from('ap-images').upload(path, file, { contentType: 'image/png', upsert: false });
  if (error) throw error;
  return { bucket: 'ap-images', path, version: checksum.slice(0, 12), sha256: checksum, nome: file.name, ativo: true };
}

export function assetPreviewUrl(supabase, asset) {
  if (!asset?.bucket || !asset?.path) return null;
  return supabase.storage.from(asset.bucket).getPublicUrl(asset.path).data.publicUrl;
}