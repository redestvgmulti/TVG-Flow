// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 1: Data Ingestion Worker
// Lê fontes RSS ativas e insere notícias brutas em ap.candidate_news.
// Triggered by: pg_cron (every 30 min)
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH_LIMIT = 10;

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
      const res = await fetch(source.url, { headers: { "User-Agent": "FlowOS AutoPublisher/1.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml = await res.text();
      const items = parseRssItems(xml);

      for (const item of items) {
        const { error: insertErr } = await supabase.schema("ap").from("candidate_news").insert({
          cliente_id: source.cliente_id,
          fonte_id: source.id,
          titulo: item.title,
          conteudo: item.description,
          url_original: item.link,
          imagem_url: item.imageUrl ?? null,
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
