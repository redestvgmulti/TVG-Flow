// 2B.2.1: hands a ready_for_render ap.editorial_articles row to the
// P0-protected render pipeline. Reads/writes nothing in ap.candidate_news,
// ap.render_generations, ap_private, or any p0_* RPC directly -- it only
// creates a candidate through the two existing, already-hardened creation
// RPCs (create_candidate_with_sponsors / create_territorial_composer_candidate)
// then calls ap.attach_editorial_article_candidate and schedules exactly that
// candidate in ap-render-engine. It never starts a batch or enables a cron.
//
// Invoked synchronously by the approving admin's browser right after
// ap.approve_editorial_article_for_render succeeds -- create_territorial_composer_candidate
// requires a live auth.uid() (via ap.require_territorial_composer_access), so
// this cannot run as a detached service_role-only worker while that
// constraint stands.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { canonicalEditorialFields } from "../_shared/canonicalEditorial.mjs";
import {
  authorizeOperationalTenant,
  TenantAuthorizationError,
} from "../ap-employee-generator/tenantAuthorization.ts";
import {
  MasterConfigurationError,
  masterConfigurationPublicMessage,
  normalizeVisualModel,
  requireMasterConfiguration,
  sponsorCountFromConfig,
  type VisualModel,
} from "../ap-employee-generator/masterConfiguration.ts";
import {
  resolveVisualTitleForCreation,
  VisualTitleResolutionError,
} from "../ap-employee-generator/visualTitleResolution.ts";
import { territorialComposerEnabled } from "../ap-employee-generator/territorialComposer.ts";
import {
  createAndProcessTerritorialCandidate,
  TerritorialCandidateRpcError,
} from "../ap-employee-generator/territorialCandidateWorkflow.ts";
import { composerModeFromArticle } from "./composerModeFromArticle.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const FUNCTION_VERSION = "2026-09-20-editorial-render-dispatch.2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };
const ROTATION_TEMPLATE_SET = "default";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUUID = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

function safeToken(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9_.:@-]{1,96}$/.test(value)
    ? value
    : null;
}

type LogFields = {
  correlationId: string;
  articleId?: unknown;
  candidateId?: unknown;
  clienteId?: unknown;
  stage: string;
  result: string;
};

// Structured, sanitized logging: only stable identifiers and outcome codes
// ever reach the log line -- never headline/body/origin_reference/tokens.
function logEvent(fields: LogFields, level: "info" | "error" = "info") {
  const event = {
    component: "ap-editorial-render-dispatch",
    function_version: FUNCTION_VERSION,
    correlation_id: fields.correlationId,
    article_id: safeToken(fields.articleId),
    candidate_id: safeToken(fields.candidateId),
    cliente_id: safeToken(fields.clienteId),
    stage: fields.stage,
    result: safeToken(fields.result) || "unknown",
  };
  const serialized = JSON.stringify(event);
  if (level === "error") console.error(serialized);
  else console.log(serialized);
}

function jsonResponse(
  fields: LogFields,
  status: number,
  body: Record<string, unknown>,
) {
  logEvent(fields, status >= 400 ? "error" : "info");
  return new Response(
    JSON.stringify({ ...body, correlation_id: fields.correlationId }),
    { status, headers: jsonHeaders },
  );
}

function scheduleTargetedRender(fields: LogFields, candidateId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const internalSecret = Deno.env.get("AP_INTERNAL_WORKER_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !internalSecret) return false;

  const task = (async () => {
    const response = await fetch(`${supabaseUrl}/functions/v1/ap-render-engine`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "x-ap-internal-secret": internalSecret,
        "x-correlation-id": fields.correlationId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ newsId: candidateId }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`TARGETED_RENDER_HTTP_${response.status}`);
    await response.arrayBuffer();
    logEvent({ ...fields, candidateId, stage: "targeted_render", result: "TARGETED_RENDER_COMPLETED" });
  })().catch(() => {
    logEvent(
      { ...fields, candidateId, stage: "targeted_render", result: "TARGETED_RENDER_FAILED" },
      "error",
    );
  });

  EdgeRuntime.waitUntil(task);
  logEvent({ ...fields, candidateId, stage: "targeted_render", result: "TARGETED_RENDER_SCHEDULED" });
  return true;
}

function tenantAuthorizationMessage(error: TenantAuthorizationError): string {
  if (error.code === "AUTH_REQUIRED") return "Autenticacao obrigatoria.";
  if (error.code === "AUTH_INVALID") return "Autenticacao invalida.";
  if (error.code === "AUTH_USER_MISMATCH") {
    return "A identidade informada nao corresponde ao usuario autenticado.";
  }
  if (error.code === "TENANT_FORBIDDEN") {
    return "Voce nao tem acesso a este cliente.";
  }
  return "Nenhum cliente operacional autorizado foi encontrado.";
}

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID();
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ correlationId, stage: "startup", result: "METHOD_NOT_ALLOWED" }, 405, {
      error: "METHOD_NOT_ALLOWED",
    });
  }

  let fields: LogFields = { correlationId, stage: "startup", result: "" };
  try {
    let articleId: unknown;
    try {
      ({ article_id: articleId } = await req.json());
    } catch {
      return jsonResponse({ ...fields, stage: "parse_request", result: "INVALID_JSON" }, 400, {
        error: "INVALID_JSON",
      });
    }
    if (!isUUID(articleId)) {
      return jsonResponse(
        { ...fields, stage: "parse_request", result: "ARTICLE_ID_INVALID" },
        400,
        { error: "ARTICLE_ID_INVALID" },
      );
    }
    fields = { ...fields, articleId };

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    fields = { ...fields, stage: "claim" };
    const { data: claimRows, error: claimError } = await supabase
      .schema("ap")
      .rpc("claim_editorial_article_for_render", { p_article_id: articleId });
    if (claimError) {
      return jsonResponse({ ...fields, result: "ARTICLE_NOT_READY_FOR_RENDER" }, 409, {
        error: "ARTICLE_NOT_READY_FOR_RENDER",
        message: "Este artigo nao esta pronto para gerar arte.",
      });
    }
    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!claim) {
      return jsonResponse({ ...fields, result: "ARTICLE_NOT_FOUND" }, 404, {
        error: "ARTICLE_NOT_FOUND",
      });
    }
    fields = { ...fields, clienteId: claim.cliente_id };

    // Already dispatched by an earlier attempt: idempotent success, no new writes.
    if (claim.candidate_news_id) {
      const renderScheduled = scheduleTargetedRender(fields, claim.candidate_news_id);
      return jsonResponse(
        { ...fields, candidateId: claim.candidate_news_id, stage: "complete", result: renderScheduled ? "ALREADY_DISPATCHED" : "TARGETED_RENDER_CONFIG_MISSING" },
        renderScheduled ? 200 : 503,
        {
          success: renderScheduled,
          candidate_news_id: claim.candidate_news_id,
          status: claim.status,
          reused: true,
          render_scheduled: renderScheduled,
        },
      );
    }

    fields = { ...fields, stage: "authorize_caller" };
    const userSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: req.headers.get("Authorization")! } },
        auth: { autoRefreshToken: false, persistSession: false },
      },
    );
    try {
      // The caller must be authorized for the article's OWN tenant -- never
      // a tenant supplied by the request body. This also doubles as the
      // "never trust a frontend cliente_id" check: the id being authorized
      // against came from a service-role read of the article, not the client.
      await authorizeOperationalTenant({
        authorization: req.headers.get("Authorization"),
        requestedClienteId: claim.cliente_id,
        requestedAuthUserId: undefined,
        createUserClient: (token: string) =>
          createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_ANON_KEY")!,
            {
              global: { headers: { Authorization: `Bearer ${token}` } },
              auth: { autoRefreshToken: false, persistSession: false },
            },
          ),
      });
    } catch (error) {
      if (error instanceof TenantAuthorizationError) {
        return jsonResponse({ ...fields, result: error.code }, error.status, {
          error: error.code,
          message: tenantAuthorizationMessage(error),
        });
      }
      throw error;
    }

    fields = { ...fields, stage: "create_candidate" };
    const composerEnabled = await territorialComposerEnabled(
      supabase,
      claim.cliente_id,
    );

    let candidateId: string;
    if (composerEnabled) {
      const composerMode = composerModeFromArticle(claim);
      if (!composerMode) {
        return jsonResponse({ ...fields, result: "COMPOSER_MODE_UNRESOLVABLE" }, 409, {
          error: "COMPOSER_MODE_UNRESOLVABLE",
          message: "Nao foi possivel determinar o modo de composicao territorial deste artigo.",
        });
      }
      let territorialResult;
      try {
        territorialResult = await createAndProcessTerritorialCandidate({
          serviceSupabase: supabase,
          userSupabase,
          clienteId: claim.cliente_id,
          idempotencyKey: articleId,
          contentType: claim.content_type,
          composerMode,
          requestedHeadline: claim.headline,
          requestedText: claim.body,
          userHeadline: null,
          userText: null,
          userTag: null,
          urlOriginal: claim.origin_reference,
          imageUrl: claim.source_image_url,
          sourceMode: claim.production_input_type,
          regionId: claim.region_id,
          cityId: claim.city_id,
          visualTitleId: claim.visual_title_id,
          manualSlots: Array.isArray(claim.manual_slots) ? claim.manual_slots : [],
        });
      } catch (error) {
        if (error instanceof TerritorialCandidateRpcError) {
          return jsonResponse({ ...fields, result: "TERRITORIAL_CANDIDATE_FAILED" }, 503, {
            error: "TERRITORIAL_CANDIDATE_FAILED",
            message: "Nao foi possivel preparar a materia para render.",
          });
        }
        throw error;
      }
      candidateId = territorialResult.news.id;
    } else {
      let config: Record<string, unknown>;
      const visualModel = normalizeVisualModel(claim.visual_model) as VisualModel;
      try {
        await resolveVisualTitleForCreation(supabase, {
          visualTitleId: claim.visual_title_id,
          clienteId: claim.cliente_id,
          contentType: claim.content_type,
        });
        config = await requireMasterConfiguration({
          contentType: claim.content_type,
          visualModel,
          readControl: () =>
            supabase
              .schema("ap")
              .from("master_render_controls")
              .select("kill_switch")
              .eq("cliente_id", claim.cliente_id)
              .maybeSingle(),
          readConfig: () =>
            supabase
              .schema("ap")
              .from("master_render_configs")
              .select("*")
              .eq("cliente_id", claim.cliente_id)
              .eq("content_type", claim.content_type)
              .eq("visual_model", visualModel)
              .maybeSingle(),
        });
      } catch (error) {
        if (error instanceof VisualTitleResolutionError) {
          return jsonResponse({ ...fields, result: error.code }, 409, {
            error: error.code,
            message: "O selo da materia nao esta disponivel para este render.",
          });
        }
        if (error instanceof MasterConfigurationError) {
          return jsonResponse({ ...fields, result: error.code }, error.status, {
            error: error.code,
            message: masterConfigurationPublicMessage(error.code),
          });
        }
        throw error;
      }

      const sponsorCount = sponsorCountFromConfig(config);
      const renderSnapshotBase = {
        master_config: {
          id: config.id,
          master_template_uuid: config.master_template_uuid,
          enabled: config.enabled,
          visual_model: config.visual_model,
          sponsor_count: sponsorCount,
        },
        visual_model: config.visual_model,
        layer_map: config.layer_map,
      };

      const { data: rpcResult, error: rpcError } = await supabase
        .schema("ap")
        .rpc("create_candidate_with_sponsors", {
          p_cliente_id: claim.cliente_id,
          p_idempotency_key: articleId,
          p_content_type: claim.content_type,
          p_template_set: ROTATION_TEMPLATE_SET,
          p_sponsor_count: sponsorCount,
          p_titulo: claim.headline,
          p_conteudo: claim.body,
          p_url_original: claim.origin_reference || null,
          p_imagem_url: claim.source_image_url,
          p_context_tag: "DESTAQUE",
          p_auth_user_id: claim.author_user_id,
          p_visual_title_id: claim.visual_title_id,
          p_render_contract_version: "master_v1",
          p_render_snapshot_base: renderSnapshotBase,
        });
      if (rpcError) {
        return jsonResponse({ ...fields, result: "CANDIDATE_CREATE_FAILED" }, 503, {
          error: "CANDIDATE_CREATE_FAILED",
          message: "Nao foi possivel preparar a materia para render.",
        });
      }
      const news = rpcResult?.candidate_news;
      if (!news?.id) {
        return jsonResponse({ ...fields, result: "CANDIDATE_INVALID_RESPONSE" }, 503, {
          error: "CANDIDATE_INVALID_RESPONSE",
        });
      }
      candidateId = news.id;

      // Same claim -> canonicalize -> pending_render sequence ap-employee-generator
      // uses for a brand-new candidate. A reused candidate that already
      // advanced past processing was already finished by a prior attempt.
      if (!["pending_render", "pending_review", "approved"].includes(news.status)) {
        const { data: claimed } = await supabase
          .schema("ap")
          .from("candidate_news")
          .update({ processing_started_at: new Date().toISOString() })
          .eq("id", news.id)
          .eq("status", "processing")
          .is("processing_started_at", null)
          .select("id")
          .maybeSingle();
        if (claimed?.id) {
          try {
            const canonical = canonicalEditorialFields(news);
            // claim.caption is the AI-authored social caption (hashtags,
            // source line) from the latest revision; canonical.caption is
            // only a body-text fallback for candidates with no such claim.
            const finalCaption = claim.caption?.trim() || canonical.caption;
            const { error: updateError } = await supabase
              .schema("ap")
              .from("candidate_news")
              .update({
                status: "pending_render",
                headline: canonical.headline,
                caption: finalCaption,
                context_tag: canonical.context_tag,
                roteiro_json: canonical.roteiro_json,
                processing_started_at: null,
              })
              .eq("id", news.id);
            if (updateError) throw new Error("CANDIDATE_UPDATE_FAILED");
          } catch (finalizeError) {
            await supabase
              .schema("ap")
              .from("candidate_news")
              .update({ processing_started_at: null })
              .eq("id", news.id)
              .eq("status", "processing");
            throw finalizeError;
          }
        }
      }
    }

    fields = { ...fields, candidateId, stage: "attach" };
    const { error: attachError } = await supabase
      .schema("ap")
      .rpc("attach_editorial_article_candidate", {
        p_article_id: articleId,
        p_candidate_news_id: candidateId,
      });
    if (attachError) {
      return jsonResponse({ ...fields, result: "ATTACH_FAILED" }, 500, {
        error: "ATTACH_FAILED",
        message: "A materia foi criada, mas nao foi possivel vincular ao artigo editorial. Tente novamente com o mesmo artigo.",
        candidate_news_id: candidateId,
      });
    }

    const renderScheduled = scheduleTargetedRender(fields, candidateId);
    if (!renderScheduled) {
      return jsonResponse(
        { ...fields, candidateId, stage: "targeted_render", result: "TARGETED_RENDER_CONFIG_MISSING" },
        503,
        {
          success: false,
          error: "TARGETED_RENDER_CONFIG_MISSING",
          candidate_news_id: candidateId,
          message: "A materia entrou na fila, mas o render nao pode ser iniciado. Tente novamente.",
        },
      );
    }

    return jsonResponse({ ...fields, stage: "complete", result: "DISPATCHED" }, 200, {
      success: true,
      candidate_news_id: candidateId,
      status: "dispatched",
      reused: false,
      render_scheduled: true,
    });
  } catch (error) {
    logEvent({ ...fields, result: "INTERNAL_ERROR" }, "error");
    console.error(JSON.stringify({
      component: "ap-editorial-render-dispatch",
      correlation_id: correlationId,
      stage: fields.stage,
      error: error instanceof Error ? error.message : String(error),
    }));
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR", correlation_id: correlationId }),
      { status: 500, headers: jsonHeaders },
    );
  }
});

console.log(JSON.stringify({
  component: "ap-editorial-render-dispatch",
  function_version: FUNCTION_VERSION,
  stage: "startup",
  result: "FUNCTION_READY",
}));
