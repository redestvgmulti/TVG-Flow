// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 1: Data Ingestion Worker
// Lê fontes RSS e insere apenas notícias das últimas 24h.
// Triggered by: pg_cron (every 30 min)
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { classifyCategory } from "../_shared/categoryHeuristics.ts";

const BATCH_LIMIT = 50;
const MAX_AGE_HOURS = 24;

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "configuration_error" }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const cutoffMs = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;

  // 1. Identificar locatários que PAUSARAM o motor de ingestão globalmente
  const { data: disabledConfigs } = await supabase
    .schema("ap").from("system_config")
    .select("cliente_id")
    .eq("ingestion_enabled", false);

  const disabledClienteIds = disabledConfigs?.map((c: any) => c.cliente_id) || [];

  // 2. Fetch active sources (ignoring paused tenants)
  let query = supabase
    .schema("ap").from("sources")
    .select("id, cliente_id, url")
    .eq("ativo", true);

  if (disabledClienteIds.length > 0) {
    query = query.not("cliente_id", "in", `(${disabledClienteIds.join(',')})`);
  }

  const { data: sources, error: sourcesError } = await query.limit(BATCH_LIMIT);

  if (sourcesError) {
    console.error("[ap-data-ingestion] fetch sources error:", sourcesError.message);
    return new Response(JSON.stringify({ error: "fetch_sources_failed" }), { status: 500 });
  }

  const results: { source_id: string; inserted: number; skipped_old: number; errors: number }[] = [];

  for (const source of sources ?? []) {
    let inserted = 0;
    let skipped_old = 0;
    let errors = 0;

    try {
      console.log(`[ap-data-ingestion] processing source ${source.id}: ${source.url}`);
      let fetchUrl = source.url;

      if (fetchUrl.includes("instagram.com")) {
        const match = fetchUrl.match(/instagram\.com\/([^\\/?#]+)/i);
        if (match?.[1]) fetchUrl = `https://rsshub.anyat.icu/instagram/user/${match[1]}`;
      }

      // Add 10s timeout to source fetch
      const abSource = new AbortController();
      const timerSource = setTimeout(() => abSource.abort(), 10000);
      const res = await fetch(fetchUrl, {
        signal: abSource.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      }).finally(() => clearTimeout(timerSource));
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml = await res.text();
      const rawItems = parseRssItems(xml);

      // Keep only items published in the last 24h
      const recentItems = rawItems.filter(item => {
        if (!item.pubDate) return true;
        const pubMs = new Date(item.pubDate).getTime();
        if (isNaN(pubMs)) return true;
        return pubMs >= cutoffMs;
      });

      skipped_old = rawItems.length - recentItems.length;
      if (skipped_old > 0) {
        console.log(`[ap-data-ingestion] source ${source.id}: skipped ${skipped_old} items older than ${MAX_AGE_HOURS}h`);
      }

      // Process up to 10 items per source to balance freshness and resources
      const itemsToProcess = recentItems.slice(0, 10);

      const items = [];
      for (const item of itemsToProcess) {
          let studio_media_video_url = null;
          let studio_media_image_url = item.imageUrl ?? null;

          try {
            console.log(`[ap-data-ingestion] fetching item: ${item.link}`);
            const ab = new AbortController();
            const timer = setTimeout(() => ab.abort(), 10000);
            const r = await fetch(item.link, {
              signal: ab.signal,
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
                "Accept": "text/html,*/*"
              }
            }).finally(() => clearTimeout(timer));

            if (r?.ok) {
              const html = await r.text();
              
              // Simple regex instead of Cheerio to save memory and CPU
              const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                              html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)?.[1];
              
              const ogVideo = html.match(/<meta[^>]*property=["']og:video["'][^>]*content=["']([^"']+)["']/i)?.[1];

              if (ogImage) {
                let imgUrl = ogImage.trim();
                if (imgUrl.match(/^\/\/[^\/]/)) {
                  imgUrl = `https:${imgUrl}`;
                } else if (imgUrl.startsWith('/')) {
                  const urlObj = new URL(item.link);
                  imgUrl = `${urlObj.protocol}//${urlObj.host}${imgUrl}`;
                }
                studio_media_image_url = imgUrl;
              }
              if (ogVideo) {
                let vidUrl = ogVideo;
                if (vidUrl.startsWith('/')) {
                  const urlObj = new URL(item.link);
                  vidUrl = `${urlObj.protocol}//${urlObj.host}${vidUrl}`;
                }
                studio_media_video_url = vidUrl;
              }
            }
          } catch (e: any) { 
              console.error(`[ap-data-ingestion] item fetch error: ${e.message}`);
          }

          items.push({ ...item, studio_media_image_url, studio_media_video_url });
      }

      for (const item of items) {
        const finalImageUrl = item.imageUrl?.trim() || item.studio_media_image_url || null;

        const { error: insertErr } = await supabase.schema("ap").from("candidate_news").insert({
          cliente_id: source.cliente_id,
          fonte_id: source.id,
          titulo: item.title,
          conteudo: item.description,
          url_original: item.link,
          imagem_url: finalImageUrl,
          studio_media_image_url: item.studio_media_image_url,
          studio_media_video_url: item.studio_media_video_url,
          published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
          categoria: classifyCategory(item.title, item.description || ""),
          status: "raw",
          source: "rss"
        });

        if (insertErr) {
          if (insertErr.code !== '23505') {
            console.error(`[ap-data-ingestion] insert error for ${item.link}:`, insertErr.message);
            errors++;
          }
        } else {
          inserted++;
        }
      }
    } catch (err) {
      console.error(`[ap-data-ingestion] source ${source.id} error:`, err);
      errors++;
    }

    results.push({ source_id: source.id, inserted, skipped_old, errors });
  }

  return new Response(JSON.stringify({ ok: true, max_age_hours: MAX_AGE_HOURS, results }), {
    headers: { "Content-Type": "application/json" },
  });
});

function parseRssItems(xml: string) {
  const items: { title: string; link: string; description?: string; imageUrl?: string; pubDate?: string }[] = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, "title");
    const link = extractTag(block, "link") || extractAttr(block, "link", "href");
    if (!title || !link) continue;
    items.push({
      title: title.trim(),
      link: link.trim(),
      description: extractTag(block, "description")?.trim(),
      imageUrl: extractAttr(block, "media:content", "url") || extractAttr(block, "enclosure", "url"),
      pubDate: extractTag(block, "pubDate") || extractTag(block, "published"),
    });
  }
  return items;
}

function extractTag(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"))?.[1];
}

function extractAttr(xml: string, tag: string, attr: string): string | undefined {
  return xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i"))?.[1];
}
