import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildLegacyLayers,
  buildProfileMasterLayers,
  claimPendingRender,
  detectRenderPath,
  prepareRotationV1Render,
  RenderContractError,
  type RenderLayers,
} from "./renderContract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

type RenderPlan = {
  path: "legacy" | "master_profile_v1" | "master_rotation_v1";
  templateId: string;
  layers: RenderLayers;
  fallbackReason?: string;
};

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stableError(error: unknown): RenderContractError {
  if (error instanceof RenderContractError) return error;
  const raw = error instanceof Error ? error.message : String(error);
  const sanitized = raw
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/https?:\/\/[^\s]+/gi, "[URL_REDACTED]")
    .slice(0, 500);
  return new RenderContractError("RENDER_UNEXPECTED", sanitized);
}

async function killSwitchEnabled(supabase: any, clienteId: string) {
  const { data, error } = await supabase
    .schema("ap")
    .from("master_render_controls")
    .select("kill_switch")
    .eq("cliente_id", clienteId)
    .maybeSingle();
  if (error) throw new RenderContractError("MASTER_CONTROL_READ_FAILED");
  return Boolean(data?.kill_switch);
}

async function resolveProfileMaster(supabase: any, item: Record<string, any>) {
  const snapshot = record(item.render_snapshot);
  if (!snapshot || !item.template_id) {
    return { enabled: false, reason: "profile_snapshot_invalid" };
  }

  const { data: configs, error } = await supabase
    .schema("ap")
    .from("master_render_configs")
    .select("*")
    .eq("cliente_id", item.cliente_id)
    .eq("content_type", item.content_type || "feed")
    .eq("enabled", true)
    .or(
      `template_set.eq.${item.template_set || "default"},template_set.is.null`,
    );
  if (error) throw new RenderContractError("MASTER_CONFIG_READ_FAILED");
  const config = (configs || []).sort(
    (a: any, b: any) =>
      Number(Boolean(b.template_set)) - Number(Boolean(a.template_set)),
  )[0];
  if (
    !nonEmpty(config?.master_template_uuid) ||
    !record(config?.layer_map) ||
    !nonEmpty(config.layer_map.visual_title)
  ) {
    return { enabled: false, reason: "master_config_invalid" };
  }
  if (!record(snapshot.visual_title) || !record(snapshot.sponsor_profile)) {
    return { enabled: false, reason: "profile_snapshot_invalid" };
  }
  return { enabled: true, config };
}

function snapshotLegacyTemplate(item: Record<string, any>) {
  const snapshot = record(item.render_snapshot);
  const template = record(snapshot?.template);
  return nonEmpty(item.placid_template_uuid) ||
    nonEmpty(template?.legacy_placid_template_uuid) ||
    nonEmpty(snapshot?.legacy_placid_template_uuid);
}

async function resolveLegacyTemplateId(
  supabase: any,
  item: Record<string, any>,
  allowTemplateRotation: boolean,
) {
  const saved = snapshotLegacyTemplate(item);
  if (saved) return saved;
  if (!allowTemplateRotation) {
    throw new RenderContractError("LEGACY_TEMPLATE_MISSING");
  }

  let ownerId = item.cliente_id;
  const { data: empresa } = await supabase
    .from("empresas")
    .select("id")
    .eq("id", ownerId)
    .maybeSingle();
  if (!empresa) {
    const { data: cliente } = await supabase
      .from("clientes")
      .select("empresa_id")
      .eq("id", ownerId)
      .maybeSingle();
    if (cliente?.empresa_id) ownerId = cliente.empresa_id;
  }

  const { data: template, error } = await supabase
    .schema("ap")
    .rpc("get_and_advance_template", {
      p_empresa_id: ownerId,
      p_tipo: item.content_type || "feed",
      p_template_set: item.template_set || "default",
    });
  if (error) throw new RenderContractError("LEGACY_TEMPLATE_RESOLUTION_FAILED");
  const resolved = nonEmpty(template?.placid_template_uuid);
  if (!resolved) throw new RenderContractError("LEGACY_TEMPLATE_MISSING");
  return resolved;
}

async function legacyPlan(
  supabase: any,
  item: Record<string, any>,
  supabaseUrl: string,
  allowTemplateRotation: boolean,
  fallbackReason?: string,
): Promise<RenderPlan> {
  return {
    path: "legacy",
    templateId: await resolveLegacyTemplateId(
      supabase,
      item,
      allowTemplateRotation,
    ),
    layers: buildLegacyLayers(item, supabaseUrl),
    fallbackReason,
  };
}

async function buildRenderPlan(
  supabase: any,
  item: Record<string, any>,
  supabaseUrl: string,
): Promise<RenderPlan> {
  const path = detectRenderPath(item);

  if (path === "master_rotation_v1") {
    const frozen = prepareRotationV1Render(item, supabaseUrl);
    if (await killSwitchEnabled(supabase, item.cliente_id)) {
      return legacyPlan(
        supabase,
        item,
        supabaseUrl,
        false,
        "kill_switch",
      );
    }
    return frozen;
  }

  if (path === "master_profile_v1") {
    if (await killSwitchEnabled(supabase, item.cliente_id)) {
      return legacyPlan(
        supabase,
        item,
        supabaseUrl,
        true,
        "kill_switch",
      );
    }
    const master = await resolveProfileMaster(supabase, item);
    if (!master.enabled) {
      return legacyPlan(
        supabase,
        item,
        supabaseUrl,
        true,
        master.reason,
      );
    }
    return {
      path: "master_profile_v1",
      templateId: master.config.master_template_uuid,
      layers: buildProfileMasterLayers({
        item,
        layerMap: master.config.layer_map,
        supabaseUrl,
      }),
    };
  }

  return legacyPlan(supabase, item, supabaseUrl, true);
}

async function requestPlacid(templateId: string, layers: RenderLayers) {
  const apiKey = Deno.env.get("RENDER_API_KEY");
  if (!apiKey) throw new RenderContractError("PLACID_API_KEY_MISSING");

  const response = await fetch("https://api.placid.app/api/rest/images", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ template_uuid: templateId, layers }),
  });
  if (!response.ok) {
    throw new RenderContractError(
      "PLACID_REQUEST_FAILED",
      `status=${response.status}`,
    );
  }

  const render = await response.json();
  let finalUrl = nonEmpty(render.image_url);
  if (!finalUrl && render.polling_url) {
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const pollResponse = await fetch(render.polling_url, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      if (!pollResponse.ok) {
        throw new RenderContractError(
          "PLACID_POLL_FAILED",
          `status=${pollResponse.status}`,
        );
      }
      const poll = await pollResponse.json();
      if (poll.status === "finished") {
        finalUrl = nonEmpty(poll.image_url);
        break;
      }
      if (poll.status === "error") {
        throw new RenderContractError("PLACID_RENDER_FAILED");
      }
    }
  }
  if (!finalUrl) throw new RenderContractError("PLACID_RENDER_TIMEOUT");
  return finalUrl;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) {
    return new Response(
      JSON.stringify({ ok: false, error: "RENDER_ENV_MISSING" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const reqBody = await req.json().catch(() => ({}));
  const targetId = reqBody.newsId || reqBody.news_id;
  const lockExpiry = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  let query = supabase
    .schema("ap")
    .from("candidate_news")
    .select("*")
    .eq("status", "pending_render")
    .is("render_url", null)
    .or(`render_started_at.is.null,render_started_at.lt.${lockExpiry}`);
  query = targetId ? query.eq("id", targetId) : query.limit(5);

  const { data: items, error: selectionError } = await query;
  if (selectionError) {
    return new Response(
      JSON.stringify({ ok: false, error: "RENDER_SELECTION_FAILED" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  if (!items?.length) {
    return new Response(JSON.stringify({ ok: true, message: "No items" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results = [];
  for (const item of items) {
    const claimedAt = new Date().toISOString();
    if (!await claimPendingRender(supabase, item, claimedAt)) continue;

    try {
      const plan = await buildRenderPlan(supabase, item, supabaseUrl);
      if (plan.fallbackReason) {
        console.warn("[ap-render-engine] explicit legacy fallback", {
          candidate_news_id: item.id,
          render_contract_version: item.render_contract_version || "legacy",
          sponsor_source: item.render_snapshot?.sponsor_source || null,
          content_type: item.content_type || "feed",
          reason: plan.fallbackReason,
        });
      }

      const finalUrl = await requestPlacid(plan.templateId, plan.layers);
      const download = await fetch(finalUrl);
      if (!download.ok) {
        throw new RenderContractError(
          "RENDER_DOWNLOAD_FAILED",
          `status=${download.status}`,
        );
      }
      const contentType = (
        download.headers.get("content-type") || "image/jpeg"
      ).toLowerCase();
      if (item.content_type === "reels" && !contentType.includes("image/png")) {
        throw new RenderContractError("REELS_OUTPUT_NOT_PNG");
      }
      const extension = contentType.includes("image/png") ? "png" : "jpg";
      const path = `${item.cliente_id}/${item.id}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("ap-renders")
        .upload(
          path,
          new Uint8Array(await download.arrayBuffer()),
          { contentType, upsert: true },
        );
      if (uploadError) {
        throw new RenderContractError("RENDER_STORAGE_UPLOAD_FAILED");
      }

      const renderUrl =
        `${supabaseUrl}/storage/v1/object/public/ap-renders/${path}`;
      const { error: persistError } = await supabase
        .schema("ap")
        .from("candidate_news")
        .update({
          render_url: renderUrl,
          imagem_url: renderUrl,
          status: "approved",
          render_started_at: null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      if (persistError) {
        throw new RenderContractError("RENDER_PERSIST_FAILED");
      }
      results.push({ id: item.id, status: "success", url: renderUrl });
    } catch (unknownError) {
      const error = stableError(unknownError);
      console.error("[ap-render-engine] render failed", {
        candidate_news_id: item.id,
        render_contract_version: item.render_contract_version || "legacy",
        sponsor_source: item.render_snapshot?.sponsor_source || null,
        content_type: item.content_type || "feed",
        error_code: error.code,
      });
      await supabase
        .schema("ap")
        .from("candidate_news")
        .update({
          status: "failed",
          error_log: error.message,
          render_started_at: null,
        })
        .eq("id", item.id);
      results.push({ id: item.id, status: "error", error: error.code });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
