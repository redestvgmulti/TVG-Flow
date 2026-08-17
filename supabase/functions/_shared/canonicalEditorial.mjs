/**
 * Produces render-facing editorial fields without generating or rewriting text.
 * `conteudo` is the canonical source for new material; an existing caption is
 * retained only for backwards compatibility with historical candidates.
 */
export function canonicalEditorialFields(candidate) {
  const hasCaption = typeof candidate.caption === "string";
  const hasHeadline = typeof candidate.headline === "string" && candidate.headline.length > 0;

  return {
    headline: hasHeadline ? candidate.headline : (candidate.titulo ?? ""),
    caption: hasCaption ? candidate.caption : (candidate.conteudo ?? ""),
    context_tag: candidate.context_tag ?? "DESTAQUE",
    roteiro_json: candidate.roteiro_json ?? null,
    roteiro_studio: candidate.roteiro_studio ?? (candidate.conteudo ?? ""),
  };
}
