import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireTrustedInternalRequest } from "../_shared/internalWorkerAuth.ts";
import { Telemetry } from "../_shared/telemetry.ts";
import { ApifyInstagramProvider } from "../_shared/social/apifyInstagramProvider.ts";
import { InstagramItem } from "../_shared/social/instagramProvider.ts";

const MAX_SOURCES_PER_RUN = 20;
const MAX_RESULTS_PER_SOURCE = 5;
const MAX_RESULTS_PER_RUN = 100;
const OVERLAP_MS = 5 * 60 * 1000;
const PARSER_VERSION = "apify-ig-v1";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function uploadThumbnail(supabase: SupabaseClient, clienteId: string, sourceId: string, item: InstagramItem): Promise<string | null> {
    if (!item.thumbnailUrl) return null;
    try {
        const abController = new AbortController();
        const timeout = setTimeout(() => abController.abort(), 10000);
        const res = await fetch(item.thumbnailUrl, { signal: abController.signal }).finally(() => clearTimeout(timeout));
        if (!res.ok) return null;
        
        const contentType = res.headers.get("content-type");
        if (!contentType?.startsWith("image/")) return null;
        
        const arrayBuffer = await res.arrayBuffer();
        if (arrayBuffer.byteLength > 10 * 1024 * 1024) return null; // 10MB limit

        const path = `ingestion/instagram/${clienteId}/${sourceId}/${item.externalId}.jpg`;
        const { error } = await supabase.storage.from("ap-images").upload(path, arrayBuffer, {
            contentType: contentType,
            upsert: true
        });

        if (error) {
            console.error("Storage upload error", error);
            return null;
        }

        const { data } = supabase.storage.from("ap-images").getPublicUrl(path);
        return data.publicUrl;
    } catch (err) {
        console.error("Thumbnail fetch/upload failed", err);
        return null;
    }
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
  
  const runTelemetry = new Telemetry(supabase);
  await runTelemetry.logStart({
    worker_name: "ap-instagram-ingestion",
    worker_id: workerId,
    action: "internal_batch",
    metadata: { parser_version: PARSER_VERSION },
  });

  const { data: disabledConfigs } = await supabase
    .schema("ap").from("system_config")
    .select("cliente_id")
    .eq("ingestion_enabled", false);
  const disabledClienteIds = disabledConfigs?.map((row: any) => row.cliente_id) ?? [];

  let sourceQuery = supabase
    .schema("ap").from("sources")
    .select("id, cliente_id, nome, url, tipo, last_success_at")
    .eq("tipo", "instagram")
    .eq("ativo", true);

  if (disabledClienteIds.length) {
    sourceQuery = sourceQuery.not("cliente_id", "in", `(${disabledClienteIds.join(",")})`);
  }
  
  const { data: sources, error: sourceError } = await sourceQuery.limit(MAX_SOURCES_PER_RUN);
  if (sourceError) {
    await runTelemetry.logError("FETCH_SOURCES_FAILED", 0, { mode: "instagram_collection" });
    return json({ error: "FETCH_SOURCES_FAILED" }, 500);
  }

  if (!sources || sources.length === 0) {
      await runTelemetry.logSuccess(0, { mode: "instagram_collection", sources: 0 });
      return json({ ok: true, sources: 0 });
  }

  const provider = new ApifyInstagramProvider();
  
  const providerOptions = {
      sources: sources.map(s => ({ id: s.id, url: s.url })),
      newerThan: null as string | null,
      maxResultsPerSource: MAX_RESULTS_PER_SOURCE
  };

  // We find the oldest last_success_at among sources to limit the Apify fetch, 
  // but Apify will fetch recent posts for each anyway.
  let globalCutoff = 0;
  for (const s of sources) {
      if (s.last_success_at) {
         const t = new Date(s.last_success_at).getTime() - OVERLAP_MS;
         if (globalCutoff === 0 || t < globalCutoff) {
             globalCutoff = t;
         }
      }
  }
  if (globalCutoff > 0) {
      providerOptions.newerThan = new Date(globalCutoff).toISOString();
  }

  let collections;
  try {
      collections = await provider.collect(providerOptions);
  } catch (error: any) {
      await runTelemetry.logError("APIFY_PROVIDER_FAILED", 0, { error: error.message });
      return json({ error: "APIFY_PROVIDER_FAILED", details: error.message }, 500);
  }

  const results: Array<Record<string, unknown>> = [];
  let globalCollectedCount = 0;
  
  for (const source of sources) {
    const sourceStartedAt = new Date().toISOString();
    const sourceStartedMs = performance.now();
    let discovered = 0;
    let valid = 0;
    let collected = 0;
    let duplicates = 0;
    let errors = 0;
    let thumbnailUploadSuccess = 0;
    let thumbnailUploadFailed = 0;

    const sourceCutoff = source.last_success_at ? new Date(source.last_success_at).getTime() - OVERLAP_MS : 0;

    const telemetry = new Telemetry(supabase);
    await telemetry.logStart({
      worker_name: "ap-instagram-ingestion",
      worker_id: workerId,
      cliente_id: source.cliente_id,
      action: "internal_batch",
      metadata: { source_id: source.id, configured_type: source.tipo },
    });

    const collection = collections.find(c => c.sourceId === source.id);
    if (!collection) continue;

    discovered = collection.items.length;

    for (const item of collection.items) {
        if (globalCollectedCount >= MAX_RESULTS_PER_RUN) {
            console.warn(`Hard cap of ${MAX_RESULTS_PER_RUN} items reached for this run.`);
            break;
        }

        const publishedMs = item.publishedAt ? new Date(item.publishedAt).getTime() : 0;
        if (sourceCutoff > 0 && publishedMs < sourceCutoff) {
            continue;
        }

        valid += 1;
        
        try {
            const uploadedUrl = await uploadThumbnail(supabase, source.cliente_id, source.id, item);
            if (uploadedUrl) {
                thumbnailUploadSuccess++;
            } else {
                thumbnailUploadFailed++;
            }

            const finalImageUrl = uploadedUrl || item.thumbnailUrl;
            
            const title = item.caption ? item.caption.split('\n')[0].substring(0, 100) : `${source.nome} — publicação no Instagram`;

            const contentHash = await sha256([
                item.canonicalUrl,
                title,
                item.caption,
                item.caption
            ].join("\n"));

            const { data, error } = await supabase.schema("ap").rpc("ingest_collected_news", {
                p_cliente_id: source.cliente_id,
                p_source_id: source.id,
                p_url_original: item.canonicalUrl, // Canonic URL passed to url_original to trigger normalized_url uniquely
                p_canonical_url: item.canonicalUrl,
                p_title: title,
                p_excerpt: item.caption,
                p_content: item.caption,
                p_image_url: finalImageUrl,
                p_published_at: item.publishedAt || null,
                p_content_hash: contentHash,
                p_parser_version: PARSER_VERSION,
                p_metadata: {
                    provider: "instagram",
                    external_id: item.externalId,
                    media_type: item.mediaType,
                    owner_username: item.sourceUsername
                }
            });

            if (error) throw error;
            if (data?.created) {
                collected += 1;
                globalCollectedCount += 1;
            } else {
                duplicates += 1;
            }
        } catch (e) {
            console.error("Error ingesting item", e);
            errors += 1;
        }
    }

    const status = errors ? "completed_with_errors" : "success";
    if (status === "success") {
        await supabase.schema("ap").from("sources").update({
            last_checked_at: new Date().toISOString(),
            last_success_at: new Date().toISOString(),
            last_error_code: null,
            consecutive_failures: 0,
            last_discovered_count: discovered,
            last_collected_count: collected,
        }).eq("id", source.id).eq("cliente_id", source.cliente_id);
    } else {
        await supabase.schema("ap").from("sources").update({
            last_checked_at: new Date().toISOString(),
            last_error_code: "ITEM_PERSIST_FAILED",
            consecutive_failures: source.consecutive_failures + 1,
            last_discovered_count: discovered,
            last_collected_count: collected,
        }).eq("id", source.id).eq("cliente_id", source.cliente_id);
    }

    await telemetry.logSuccess(0, {
        mode: "instagram_collection",
        source_id: source.id,
        discovered,
        valid,
        collected,
        duplicates,
        thumbnail_upload_success: thumbnailUploadSuccess,
        thumbnail_upload_failed: thumbnailUploadFailed,
        errors,
    });

    await supabase.schema("ap").from("source_ingestion_runs").insert({
        source_id: source.id,
        cliente_id: source.cliente_id,
        worker_id: workerId,
        detected_type: "instagram",
        status,
        discovered_count: discovered,
        collected_count: collected,
        skipped_old_count: discovered - valid,
        error_count: errors,
        error_code: errors ? "ITEM_PERSIST_FAILED" : null,
        started_at: sourceStartedAt,
        finished_at: new Date().toISOString(),
        metadata: {
            correlation_id: workerId,
            provider: "apify",
            valid_items: valid,
            duplicate_count: duplicates,
            thumbnail_upload_success: thumbnailUploadSuccess,
            thumbnail_upload_failed: thumbnailUploadFailed,
            duration_ms: Math.round(performance.now() - sourceStartedMs),
        },
    });

    results.push({
      source_id: source.id,
      discovered,
      valid,
      collected,
      duplicates,
      errors,
    });
  }

  const totalCollected = results.reduce((sum, result) => sum + Number(result.collected || 0), 0);
  const totalErrors = results.reduce((sum, result) => sum + Number(result.errors || 0), 0);
  await runTelemetry.logSuccess(0, {
    mode: "instagram_collection",
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
    results,
  });
});
