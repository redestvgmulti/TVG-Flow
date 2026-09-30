import { assertEquals } from "jsr:@std/assert";
import {
  collectedNewsExcerpt,
  collectedNewsTitle,
  instagramEditorialExcerpt,
  instagramEditorialTitle,
  normalizeCollectedNewsText,
} from "./collectedNewsEditorial.ts";

Deno.test("collected-news editorial fields normalize whitespace and retain a bounded title", () => {
  assertEquals(
    collectedNewsTitle("  Título\n\ncontinua no conteúdo  ", "Fallback"),
    "Título",
  );
  assertEquals(
    collectedNewsExcerpt("  texto\n\ncom\t espaços  "),
    "texto com espaços",
  );
  assertEquals(normalizeCollectedNewsText(" a  b ", 3), "a b");
});

Deno.test("collected-news editorial title uses fallback when the source has no usable title", () => {
  assertEquals(
    collectedNewsTitle("  \n", "Publicação de @fonte"),
    "Publicação de @fonte",
  );
  assertEquals(collectedNewsExcerpt("\n\t"), null);
});

Deno.test("Instagram editorial fields remove hashtags and use the first sentence as title", () => {
  const caption =
    "Concurso municipal vem aí! 📚✨ Saiba mais no carrossel. #Prefeitura #Educação";
  assertEquals(
    instagramEditorialTitle(caption, "Publicação de @prefeitura"),
    "Concurso municipal vem aí!",
  );
  assertEquals(
    instagramEditorialExcerpt(caption),
    "Concurso municipal vem aí! 📚✨ Saiba mais no carrossel.",
  );
});
