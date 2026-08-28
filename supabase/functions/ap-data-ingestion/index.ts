import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTrustedInternalRequest } from "../_shared/internalWorkerAuth.ts";
import { collectSource, SourceCollectionError } from "../_shared/sourceCollector.mjs";
import { Telemetry } from "../_shared/telemetry.ts";

const BATCH_LIMIT = 50;
const MAX_AGE_HOURS = 24;
const MAX_ITEMS_PER_SOURCE = 10;
const PARSER_VERSION = "collector-v2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function domainOf(value: string | null | undefined) {
  try {
    return new URL(value || "").hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    requireTrustedInternalRequest(req);
  } catch {
    return json({ error: "INTERNAL_WORKER_AUTH_REQUIRED" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "SERVER_CONFIGURATION_ERROR" }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const workerId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const cutoffMs = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;
  const runTelemetry = new Telemetry(supabase);
  await runTelemetry.logStart({
    worker_name: "ap-data-ingestion",
    worker_id: workerId,
    action: "internal_batch",
    metadata: { mode: "curated_collection", parser_version: PARSER_VERSION },
  });

  const { data: disabledConfigs } = await supabase
    .schema("ap").from("system_config")
    .select("cliente_id")
    .eq("ingestion_enabled", false);
  const disabledClienteIds = disabledConfigs?.map((row: any) => row.cliente_id) ?? [];

  let sourceQuery = supabase
    .schema("ap").from("sources")
    .select("id, cliente_id, nome, url, tipo")
    .eq("ativo", true);
  if (disabledClienteIds.length) {
    sourceQuery = sourceQuery.not("cliente_id", "in", `(${disabledClienteIds.join(",")})`);
  }
  const { data: sources, error: sourceError } = await sourceQuery.limit(BATCH_LIMIT);
  if (sourceError) {
    await runTelemetry.logError("FETCH_SOURCES_FAILED", 0, { mode: "curated_collection" });
    return json({ error: "FETCH_SOURCES_FAILED" }, 500);
  }

  const results: Array<Record<string, unknown>> = [];
  for (const source of sources ?? []) {
    const sourceStartedAt = new Date().toISOString();
    const sourceStartedMs = performance.now();
    let discovered = 0;
    let valid = 0;
    let collected = 0;
    let duplicates = 0;
    let skippedOld = 0;
    let errors = 0;
    let detectedType: string | null = null;
    let errorCode: string | null = null;
    const telemetry = new Telemetry(supabase);
    await telemetry.logStart({
      worker_name: "ap-data-ingestion",
      worker_id: workerId,
      cliente_id: source.cliente_id,
      action: "internal_batch",
      metadata: { source_id: source.id, configured_type: source.tipo },
    });

    try {
      const discovery = await collectSource(source, { maxItems: MAX_ITEMS_PER_SOURCE });
      detectedType = discovery.detectedType;
      discovered = discovery.items.length;

      for (const item of discovery.items) {
        const publishedMs = item.publishedAt ? new Date(item.publishedAt).getTime() : null;
        if (publishedMs && Number.isFinite(publishedMs) && publishedMs < cutoffMs) {
          skippedOld += 1;
          continue;
        }
        valid += 1;
        try {
          const contentHash = await sha256([
            item.canonicalUrl || item.url,
            item.title,
            item.excerpt || "",
            item.content || "",
          ].join("\n"));
          const { data, error } = await supabase.schema("ap").rpc("ingest_collected_news", {
            p_cliente_id: source.cliente_id,
            p_source_id: source.id,
            p_url_original: item.url,
            p_canonical_url: item.canonicalUrl || item.url,
            p_title: item.title,
            p_excerpt: item.excerpt || null,
            p_content: item.content || null,
            p_image_url: item.imageUrl || null,
            p_published_at: item.publishedAt || null,
            p_content_hash: contentHash,
            p_parser_version: PARSER_VERSION,
            p_metadata: {
              detected_type: discovery.detectedType,
              discovery_url: discovery.discoveryUrl,
              source_domain: domainOf(source.url),
              article_domain: domainOf(item.canonicalUrl || item.url),
            },
          });
          if (error) throw error;
          if (data?.created) collected += 1;
          else duplicates += 1;
        } catch {
          errors += 1;
        }
      }

      const status = errors ? "completed_with_errors" : "success";
      await supabase.schema("ap").from("sources").update({
        detected_type: detectedType,
        last_checked_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        last_error_code: errors ? "ITEM_PERSIST_FAILED" : null,
        consecutive_failures: 0,
        last_discovered_count: discovered,
        last_collected_count: collected,
      }).eq("id", source.id).eq("cliente_id", source.cliente_id);
      await telemetry.logSuccess(0, {
        mode: "curated_collection",
        source_id: source.id,
        detected_type: detectedType,
        discovered,
        valid,
        collected,
        duplicates,
        skipped_old: skippedOld,
        errors,
        discarded: 0,
      });
      await supabase.schema("ap").from("source_ingestion_runs").insert({
        source_id: source.id,
        cliente_id: source.cliente_id,
        worker_id: workerId,
        detected_type: detectedType,
        status,
        discovered_count: discovered,
        collected_count: collected,
        skipped_old_count: skippedOld,
        error_count: errors,
        error_code: errors ? "ITEM_PERSIST_FAILED" : null,
        started_at: sourceStartedAt,
        finished_at: new Date().toISOString(),
        metadata: {
          correlation_id: workerId,
          source_domain: domainOf(source.url),
          valid_count: valid,
          duplicate_count: duplicates,
          discarded: 0,
          duration_ms: Math.round(performance.now() - sourceStartedMs),
        },
      });
    } catch (error) {
      errorCode = error instanceof SourceCollectionError ? error.code : "SOURCE_COLLECTION_FAILED";
      errors += 1;
      const { data: currentSource } = await supabase.schema("ap").from("sources")
        .select("consecutive_failures")
        .eq("id", source.id).eq("cliente_id", source.cliente_id).maybeSingle();
      await supabase.schema("ap").from("sources").update({
        last_checked_at: new Date().toISOString(),
        last_error_code: errorCode,
        consecutive_failures: Number(currentSource?.consecutive_failures || 0) + 1,
        last_discovered_count: 0,
        last_collected_count: 0,
      }).eq("id", source.id).eq("cliente_id", source.cliente_id);
      await telemetry.logError(errorCode, 0, {
        mode: "curated_collection",
        source_id: source.id,
        configured_type: source.tipo,
        discarded: 0,
      });
      await supabase.schema("ap").from("source_ingestion_runs").insert({
        source_id: source.id,
        cliente_id: source.cliente_id,
        worker_id: workerId,
        detected_type: detectedType,
        status: "error",
        discovered_count: 0,
        collected_count: 0,
        skipped_old_count: 0,
        error_count: errors,
        error_code: errorCode,
        started_at: sourceStartedAt,
        finished_at: new Date().toISOString(),
        metadata: {
          correlation_id: workerId,
          source_domain: domainOf(source.url),
          valid_count: 0,
          duplicate_count: 0,
          discarded: 0,
          duration_ms: Math.round(performance.now() - sourceStartedMs),
        },
      });
    }

    results.push({
      source_id: source.id,
      detected_type: detectedType,
      discovered,
      valid,
      collected,
      duplicates,
      skipped_old: skippedOld,
      errors,
      error_code: errorCode,
    });
  }

  const totalCollected = results.reduce((sum, result) => sum + Number(result.collected || 0), 0);
  const totalErrors = results.reduce((sum, result) => sum + Number(result.errors || 0), 0);
  await runTelemetry.logSuccess(0, {
    mode: "curated_collection",
    result: totalErrors ? "completed_with_errors" : "success",
    sources: results.length,
    collected: totalCollected,
    duplicates: results.reduce((sum, result) => sum + Number(result.duplicates || 0), 0),
    errors: totalErrors,
    started_at: startedAt,
  });
  return json({
    ok: true,
    destination: "ap.collected_news",
    max_age_hours: MAX_AGE_HOURS,
    results,
  });
});
