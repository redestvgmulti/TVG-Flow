/**
 * Deterministic presentation fields shared by collected-news providers.
 * Provider-specific raw content remains untouched for provenance.
 */
export function normalizeCollectedNewsText(
  value: string | null | undefined,
  max: number,
) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function collectedNewsTitle(
  value: string | null | undefined,
  fallback: string,
) {
  const firstLine = (value ?? "").split(/\r?\n/).find((line) => line.trim()) ??
    "";
  const title = normalizeCollectedNewsText(firstLine, 180);
  return title.length >= 3 ? title : fallback;
}

export function collectedNewsExcerpt(value: string | null | undefined) {
  const excerpt = normalizeCollectedNewsText(value, 500);
  return excerpt || null;
}

export function normalizeInstagramEditorialText(
  value: string | null | undefined,
  max: number,
) {
  return normalizeCollectedNewsText(value, max)
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function instagramEditorialTitle(
  caption: string | null | undefined,
  fallback: string,
) {
  const firstLine =
    (caption ?? "").split(/\r?\n/).find((line) => line.trim()) ?? "";
  const cleaned = normalizeInstagramEditorialText(firstLine, 180);
  const sentence =
    cleaned.match(/^(.{3,180}?[.!?…])(?=\s|$|[^\p{L}\p{N}])/u)?.[1] ??
      cleaned;
  return sentence.length >= 3 ? sentence : fallback;
}

export function instagramEditorialExcerpt(caption: string | null | undefined) {
  const excerpt = normalizeInstagramEditorialText(caption, 500);
  return excerpt || null;
}
