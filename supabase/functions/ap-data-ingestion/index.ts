// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 1: Data Ingestion Worker
// Lê fontes RSS ativas e insere notícias brutas em ap.candidate_news.
// Triggered by: pg_cron (every 30 min)
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH_LIMIT = 30;

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "configuration_error" }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

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

  const results: { source_id: string; inserted: number; errors: number }[] = [];

  for (const source of sources ?? []) {
    let inserted = 0;
    let errors = 0;

    try {
      let fetchUrl = source.url;

      // Automatically proxy Instagram URLs to RSSHub to prevent silent ingestion failure
      if (fetchUrl.includes("instagram.com")) {
        const match = fetchUrl.match(/instagram\.com\/([^\/?#]+)/i);
        if (match && match[1]) {
          fetchUrl = `https://rsshub.app/instagram/user/${match[1]}`;
          console.log(`[ap-data-ingestion] Proxied Instagram URL: ${fetchUrl}`);
        }
      }

      const res = await fetch(fetchUrl, { headers: { "User-Agent": "FlowOS AutoPublisher/1.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml = await res.text();
      const rawItems = parseRssItems(xml);

      // Parallel fast fetch to extract OG tags using a short timeout
      const items = await Promise.all(rawItems.map(async (item) => {
        let studio_media_video_url = null;
        let studio_media_image_url = item.imageUrl ?? null;

        try {
          const ab = new AbortController();
          const timer = setTimeout(() => ab.abort(), 2000);
          const r = await fetch(item.link, { signal: ab.signal, headers: { "User-Agent": "FlowOS/1.0" } }).catch(() => null);
          clearTimeout(timer);
          if (r && r.ok) {
            // only read first 50kb to be fast
            const html = await r.text();
            const sample = html.slice(0, 50000);
            const ogImage = sample.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1];
            const ogVideo = sample.match(/<meta[^>]*property=["']og:video(:url|:secure_url)?["'][^>]*content=["']([^"']+)["']/i)?.[2];

            if (ogImage) studio_media_image_url = ogVideo ? ogVideo : ogImage; // Fallback or direct use
            if (ogImage && !ogVideo) studio_media_image_url = ogImage;
            if (ogVideo) studio_media_video_url = ogVideo;
          }
        } catch (e) {
          // Silently ignore to not block ingestion
        }
        return { ...item, studio_media_image_url, studio_media_video_url };
      }));

      for (const item of items) {
        const { error: insertErr } = await supabase.schema("ap").from("candidate_news").insert({
          cliente_id: source.cliente_id,
          fonte_id: source.id,
          titulo: item.title,
          conteudo: item.description,
          url_original: item.link,
          imagem_url: item.imageUrl ?? null,
          studio_media_image_url: item.studio_media_image_url,
          studio_media_video_url: item.studio_media_video_url,
          published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
          status: "raw",
        }).throwOnError();

        if (insertErr) {
          // ON CONFLICT (url_original, cliente_id) — silently skip duplicates
          errors++;
        } else {
          inserted++;
        }
      }
    } catch (err) {
      console.error(`[ap-data-ingestion] source ${source.id} error:`, err);
      errors++;
    }

    results.push({ source_id: source.id, inserted, errors });
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { "Content-Type": "application/json" },
  });
});

// Minimal RSS parser — no external dep, handles common RSS 2.0 + Atom
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
  const m = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
  return m?.[1];
}

function extractAttr(xml: string, tag: string, attr: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i"));
  return m?.[1];
}
