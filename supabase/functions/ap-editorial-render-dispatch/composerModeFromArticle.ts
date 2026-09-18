// ap.editorial_articles does not store composer_mode -- it is inferred
// deterministically from region_id/city_id/manual_slots, using the exact
// mutual-exclusivity rules ap-employee-generator/territorialComposer.ts's
// validateTerritorialComposerIntent already enforces (not duplicated here;
// that function still runs downstream inside create_territorial_composer_candidate
// via the values this module derives).
import type { TerritorialComposerMode } from "../ap-employee-generator/territorialComposer.ts";

export function composerModeFromArticle(article: {
  region_id: string | null;
  city_id: string | null;
  manual_slots: unknown;
}): TerritorialComposerMode | null {
  const hasRegion = typeof article.region_id === "string" &&
    article.region_id.length > 0;
  const hasCity = typeof article.city_id === "string" &&
    article.city_id.length > 0;
  const slots = Array.isArray(article.manual_slots)
    ? article.manual_slots
    : [];

  if (hasRegion && !hasCity && slots.length === 0) return "editorial";
  if (hasCity && !hasRegion && slots.length === 0) return "cities";
  if (slots.length > 0 && !hasRegion && !hasCity) return "individual";
  return null;
}
