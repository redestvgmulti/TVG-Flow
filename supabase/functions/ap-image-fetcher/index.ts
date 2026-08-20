import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Telemetry } from "../_shared/telemetry.ts";
import { createAdminClient, requireActiveOperator } from "../_shared/operatorAuth.ts";
import { isTrustedInternalRequest } from "../_shared/internalWorkerAuth.ts";
import {
  authorizeImageFetcherRequest,
  ImageFetcherAuthorizationError,
} from "../_shared/imageFetcherAuthorization.mjs";
import {
  assertImageSignature,
  fetchPublicBytes,
  SafeEgressFetchError,
} from "../_shared/safeEgressFetcher.mjs";
import { authorizeOperationalTenant } from "../ap-employee-generator/tenantAuthorization.ts";

const BATCH_LIMIT = 10;
const BUCKET = "ap-images";
const IMAGE_MAX_BYTES = 32 * 1024 * 1024;
const IMAGE_TIMEOUT_MS = 12_000;
const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const LOCK_EXPIRY_MINUTES = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: "SERVER_CONFIGURATION_ERROR" }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const loadCandidate = async (candidateId: string) => {
    const { data, error } = await supabase
      .schema("ap")
      .from("candidate_news")
      .select("id, cliente_id, imagem_url, status, processing_started_at")
      .eq("id", candidateId)
      .maybeSingle();
    if (error) throw error;
    return data;
  };

  let access;
  try {
    access = await authorizeImageFetcherRequest({
      body,
      internalRequest: isTrustedInternalRequest(req),
      requireOperator: (roles: Array<"admin" | "staff">) =>
        requireActiveOperator(req, createAdminClient(), roles),
      loadCandidate,
      authorizeTenant: (clienteId: string) =>
        authorizeOperationalTenant({
          authorization: req.headers.get("Authorization"),
          requestedClienteId: clienteId,
          requestedAuthUserId: null,
          createUserClient: (token: string) => createClient(
            supabaseUrl,
            anonKey,
            { global: { headers: { Authorization: `Bearer ${token}` } } },
          ),
        }),
    });
  } catch (error) {
    if (error instanceof ImageFetcherAuthorizationError) {
      return json({ error: error.code }, error.status);
    }
    return json({ error: "AUTHORIZATION_FAILED" }, 403);
  }

  const workerId = crypto.randomUUID();
  const runTelemetry = new Telemetry(supabase);
  await runTelemetry.logStart({
    worker_name: "ap-image-fetcher",
    worker_id: workerId,
    action: access.mode,
    metadata: { mode: access.mode },
  });
  const expiryCutoff = new Date(Date.now() - LOCK_EXPIRY_MINUTES * 60 * 1000).toISOString();
  let items: any[] = [];
  if (access.candidate) {
    if (access.candidate.status !== "raw") {
      return json({ error: "CANDIDATE_NOT_PROCESSABLE" }, 409);
    }
    items = [access.candidate];
  } else {
    const { data, error } = await supabase
      .schema("ap")
      .from("candidate_news")
      .select("id, cliente_id, imagem_url, status, processing_started_at")
      .eq("status", "raw")
      .or(`processing_started_at.is.null,processing_started_at.lt.${expiryCutoff}`)
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (error) {
      await runTelemetry.logError("CANDIDATE_SELECTION_FAILED", 0, { mode: access.mode, result: "error" });
      return json({ error: "CANDIDATE_SELECTION_FAILED" }, 500);
    }
    items = data || [];
  }

  const results: Array<{ id: string; result: string }> = [];
  for (const item of items) {
    const telemetry = new Telemetry(supabase);
    await telemetry.logStart({
      worker_name: "ap-image-fetcher",
      worker_id: workerId,
      news_id: item.id,
      cliente_id: item.cliente_id,
      action: access.mode,
      metadata: { mode: access.mode },
    });

    const observedLock = typeof item.processing_started_at === "string"
      ? item.processing_started_at
      : null;
    const observedLockMs = observedLock ? Date.parse(observedLock) : null;
    if (
      observedLock !== null &&
      (!Number.isFinite(observedLockMs) || observedLockMs! >= Date.parse(expiryCutoff))
    ) {
      await telemetry.logError("LOCK_NOT_ACQUIRED", 0, {
        mode: access.mode,
        result: "lock_contention",
      });
      continue;
    }

    const lockTime = new Date().toISOString();
    let lockQuery = supabase
      .schema("ap")
      .from("candidate_news")
      .update({ processing_started_at: lockTime })
      .eq("id", item.id)
      .eq("status", "raw");
    lockQuery = observedLock === null
      ? lockQuery.is("processing_started_at", null)
      : lockQuery.eq("processing_started_at", observedLock);
    const { data: locked, error: lockError } = await lockQuery.select("id");
    if (lockError || !locked?.length) {
      await telemetry.logError("LOCK_NOT_ACQUIRED", 0, { mode: access.mode, result: "lock_contention" });
      continue;
    }

    try {
      const targetImageUrl = item.imagem_url || null;
      let storagePath: string | null = null;
      let outcome = "no_image";
      let externalStatus: number | null = null;
      let bytes = 0;
      let mime: string | null = null;
      let sanitizedError: string | null = null;

      if (targetImageUrl) {
        try {
          const fetched = await fetchPublicBytes(targetImageUrl, {
            allowedContentTypes: IMAGE_MIME_TYPES,
            maxBytes: IMAGE_MAX_BYTES,
            timeoutMs: IMAGE_TIMEOUT_MS,
            maxRedirects: 3,
            headers: {
              "User-Agent": "TVG-Flow-Image-Fetcher/1.0 (+https://tvgflow.com.br)",
              "Accept": "image/avif,image/webp,image/png,image/jpeg",
              "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
            },
          });
          const detected = assertImageSignature(fetched.bytes, fetched.contentType);
          externalStatus = fetched.status;
          bytes = fetched.bytes.byteLength;
          mime = detected.contentType;
          storagePath = `${item.id}.${detected.extension}`;
          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, fetched.bytes, { contentType: mime, upsert: true });
          if (uploadError) {
            storagePath = null;
            outcome = "storage_error";
            sanitizedError = "STORAGE_UPLOAD_FAILED";
          } else {
            outcome = "stored";
          }
        } catch (error) {
          if (error instanceof SafeEgressFetchError) {
            outcome = "egress_rejected";
            externalStatus = error.status;
            sanitizedError = error.code;
          } else {
            outcome = "fetch_failed";
            sanitizedError = "FETCH_FAILED";
          }
        }
      }

      const { error: updateError } = await supabase
        .schema("ap")
        .from("candidate_news")
        .update({
          imagem_storage: storagePath,
          imagem_url: targetImageUrl,
          image_external: storagePath === null && targetImageUrl !== null,
          status: "ready_for_scoring",
          processing_started_at: null,
        })
        .eq("id", item.id)
        .eq("status", "raw")
        .eq("processing_started_at", lockTime);
      if (updateError) throw updateError;

      await telemetry.logSuccess(0, {
        mode: access.mode,
        result: outcome,
        external_http_status: externalStatus,
        bytes,
        mime,
        error_code: sanitizedError,
      });
      results.push({ id: item.id, result: outcome });
    } catch {
      await supabase
        .schema("ap")
        .from("candidate_news")
        .update({ processing_started_at: null })
        .eq("id", item.id)
        .eq("processing_started_at", lockTime);
      await telemetry.logError("PROCESSING_FAILED", 0, { mode: access.mode, result: "error" });
      results.push({ id: item.id, result: "error" });
    }
  }

  await runTelemetry.logSuccess(0, {
    mode: access.mode,
    result: "completed",
    processed: results.length,
    failures: results.filter((result) => result.result === "error").length,
  });
  return json({ ok: true, correlation_id: workerId, processed: results });
});
