import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";
import {
  fetchPublicHtml,
  SafeLinkFetchError,
  sanitizeUrlForLog,
} from "../_shared/safeLinkFetcher.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function errorResponse(message: string, status: number, correlationId: string) {
  return new Response(JSON.stringify({ error: message, correlation_id: correlationId }), {
    status,
    headers: jsonHeaders,
  });
}

function statusFor(error: SafeLinkFetchError) {
  switch (error.code) {
    case "UNSUPPORTED_PROTOCOL":
    case "INVALID_URL":
    case "PRIVATE_DESTINATION":
    case "INVALID_REDIRECT":
      return 400;
    case "REQUEST_TIMEOUT":
      return 408;
    case "RESPONSE_TOO_LARGE":
      return 413;
    case "UNSUPPORTED_CONTENT_TYPE":
      return 415;
    case "DNS_LOOKUP_FAILED":
    case "FETCH_FAILED":
    case "UPSTREAM_HTTP_ERROR":
    case "TOO_MANY_REDIRECTS":
      return 502;
    default:
      return 400;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const correlationId = crypto.randomUUID();

  if (req.method !== "POST") {
    return errorResponse("Metodo nao permitido", 405, correlationId);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization?.match(/^Bearer\s+.+$/i)) {
    return errorResponse("Autenticacao obrigatoria", 401, correlationId);
  }

  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user?.id) {
    return errorResponse("Autenticacao invalida", 401, correlationId);
  }

  let rawUrl: unknown;
  try {
    ({ url: rawUrl } = await req.json());
  } catch {
    return errorResponse("Payload invalido", 400, correlationId);
  }
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return errorResponse("URL e obrigatoria", 400, correlationId);
  }

  console.log(JSON.stringify({
    event: "LINK_SCRAPE_REQUESTED",
    correlation_id: correlationId,
    user_id: authData.user.id,
    target: sanitizeUrlForLog(rawUrl),
  }));

  try {
    const { html, finalUrl } = await fetchPublicHtml(rawUrl);
    const $ = cheerio.load(html);

    const title = $("meta[property='og:title']").attr("content") ||
      $("title").text() ||
      $("h1").first().text();
    let imageUrl = $("meta[property='og:image']").attr("content") ||
      $("meta[name='twitter:image']").attr("content") ||
      $("article img").first().attr("src");
    let videoUrl = $("meta[property='og:video']").attr("content") ||
      $("meta[property='og:video:url']").attr("content") ||
      $("meta[property='og:video:secure_url']").attr("content") || null;

    if (imageUrl?.startsWith("/")) imageUrl = new URL(imageUrl, finalUrl).toString();
    if (videoUrl?.startsWith("/")) videoUrl = new URL(videoUrl, finalUrl).toString();

    let content = "";
    const articleNode = $("article").length > 0 ? $("article") :
      ($("main").length > 0 ? $("main") : $("body"));
    articleNode.find("p").each((_, element) => {
      const text = $(element).text().trim();
      if (text.length > 30) content += `${text}\n\n`;
    });
    if (!content || content.trim().length < 50) {
      content = $("meta[property='og:description']").attr("content") ||
        $("meta[name='description']").attr("content") || "";
    }

    return new Response(JSON.stringify({
      // Existing form consumers depend on this exact response contract.
      title: title?.trim() || "",
      image_url: imageUrl?.trim() || "",
      content: content.trim(),
      studio_media_image_url: imageUrl?.trim() || "",
      studio_media_video_url: videoUrl?.trim() || null,
    }), { headers: jsonHeaders });
  } catch (error) {
    if (error instanceof SafeLinkFetchError) {
      console.warn(JSON.stringify({
        event: "LINK_SCRAPE_BLOCKED",
        correlation_id: correlationId,
        code: error.code,
        target: sanitizeUrlForLog(rawUrl),
      }));
      return errorResponse(error.message, statusFor(error), correlationId);
    }
    console.error(JSON.stringify({
      event: "LINK_SCRAPE_FAILED",
      correlation_id: correlationId,
      target: sanitizeUrlForLog(rawUrl),
    }));
    return errorResponse("Erro desconhecido ao processar link", 500, correlationId);
  }
});
