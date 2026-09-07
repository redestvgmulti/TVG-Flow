import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";
import { fetchPublicHtml } from "./safeLinkFetcher.mjs";

function absoluteHttpUrl(value: string | undefined, baseUrl: string) {
  if (!value?.trim()) return null;
  try {
    const resolved = new URL(value.trim(), baseUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:" ? resolved.toString() : null;
  } catch {
    return null;
  }
}

export async function extractPublicArticle(rawUrl: string, fetchOptions: any = {}) {
  const { html, finalUrl } = await fetchPublicHtml(rawUrl, fetchOptions);
  const $ = cheerio.load(html);

  const title = $("meta[property='og:title']").attr("content") ||
    $("title").text() ||
    $("h1").first().text() || "";
  const imageUrl = absoluteHttpUrl(
    $("meta[property='og:image']").attr("content") ||
      $("meta[name='twitter:image']").attr("content") ||
      $("article img").first().attr("src"),
    finalUrl,
  );

  const articleNode = $("article").length > 0 ? $("article") :
    ($("main").length > 0 ? $("main") : $("body"));
  articleNode.find("script, style, nav, header, footer, form, aside").remove();
  const paragraphs: string[] = [];
  articleNode.find("p").each((_, element) => {
    const text = $(element).text().replace(/\s+/g, " ").trim();
    if (text.length > 30) paragraphs.push(text);
  });

  let content = paragraphs.join("\n\n");
  if (content.length < 50) {
    content = $("meta[property='og:description']").attr("content") ||
      $("meta[name='description']").attr("content") || "";
  }

  return {
    title: title.replace(/\s+/g, " ").trim(),
    content: content.trim(),
    imageUrl,
    finalUrl,
  };
}
