import { extractPublicArticle } from "../supabase/functions/_shared/linkArticleExtractor.ts";

function assertEquals(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
}

Deno.test("extractPublicArticle extracts title, article text and an absolute image through the safe fetcher", async () => {
  const paragraph = "A apuração confirmou os dados com fontes identificadas e informações suficientes para a matéria.";
  const article = await extractPublicArticle("https://news.example.com/reportagem", {
    resolveDns: async () => ["93.184.216.34"],
    fetchImpl: async () => new Response(`<!doctype html>
      <html><head>
        <title>Título de fallback</title>
        <meta property="og:title" content="Título confirmado">
        <meta property="og:image" content="/foto-principal.jpg">
      </head><body><nav><p>Texto de navegação que não deve entrar.</p></nav><article>
        <p>${paragraph}</p><p>${paragraph}</p><p>${paragraph}</p>
      </article></body></html>`, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
  });

  assertEquals(article.title, "Título confirmado", "title");
  assertEquals(article.imageUrl, "https://news.example.com/foto-principal.jpg", "imageUrl");
  assertEquals(article.finalUrl, "https://news.example.com/reportagem", "finalUrl");
  if (article.content.length < 200 || article.content.includes("navegação")) {
    throw new Error("article content was not extracted from the article body");
  }
});
