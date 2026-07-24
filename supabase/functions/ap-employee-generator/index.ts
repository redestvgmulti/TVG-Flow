import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { runEditorialWorkflow } from "../_shared/editorialWorkflow.ts";
import {
  resolveVisualTitleForCreation,
  shouldResolveVisualTitleForCreation,
  VisualTitleResolutionError,
} from "./visualTitleResolution.ts";
import {
  authorizeOperationalTenant,
  TenantAuthorizationError,
} from "./tenantAuthorization.ts";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE" };
const isUUID = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isUrl = (value: unknown) => { try { new URL(String(value)); return true; } catch { return false; } };
const normalize = (payload: Record<string, any>) => Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, value === undefined || value === "" ? null : value]));

async function rotateTemplate(supabase: any, ownerId: string, contentType: string, templateSet: string) {
  const { data, error } = await supabase.schema("ap").rpc("get_and_advance_template", { p_empresa_id: ownerId, p_tipo: contentType, p_template_set: templateSet });
  if (error || !data?.placid_template_uuid) return null;
  return { id: data.id ?? null, placid_template_uuid: data.placid_template_uuid, ordem: data.ordem ?? null, nome: data.nome ?? null, template_set: data.template_set ?? templateSet };
}
function profileSlots(profile: any) { return { sponsor_top: profile?.sponsor_top ?? null, sponsor_footer_1: profile?.sponsor_footer_1 ?? null, sponsor_footer_2: profile?.sponsor_footer_2 ?? null, sponsor_footer_3: profile?.sponsor_footer_3 ?? null, ...(profile?.other_slots || {}) }; }
const parseSponsorCount = (value: unknown) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && [0, 1, 2].includes(parsed) ? parsed : null;
};
const hasLayerName = (map: any, key: string) => typeof map?.[key] === 'string' && Boolean(map[key].trim());
const responseForNews = (news: any, reused = false) => ({
  success: true,
  reused,
  news_id: news.id,
  status: news.status,
  headline: news.headline ?? null,
  caption: news.caption ?? null,
  context_tag: news.context_tag ?? null,
  render_pending: news.status === 'pending_render',
});
const visualTitleErrorResponse = (error: VisualTitleResolutionError) =>
  new Response(
    JSON.stringify({
      error: error.code,
      message: "O selo da mat\u00e9ria n\u00e3o est\u00e1 dispon\u00edvel para esta cria\u00e7\u00e3o.",
    }),
    { status: 400, headers: corsHeaders },
  );
const tenantAuthorizationErrorResponse = (error: TenantAuthorizationError) =>
  new Response(
    JSON.stringify({
      error: error.code,
      message: error.code === "AUTH_REQUIRED"
        ? "Autenticação obrigatória."
        : error.code === "AUTH_INVALID"
        ? "Autenticação inválida."
        : error.code === "AUTH_USER_MISMATCH"
        ? "A identidade informada não corresponde ao usuário autenticado."
        : error.code === "TENANT_FORBIDDEN"
        ? "Cliente não autorizado para este usuário."
        : "Nenhum cliente operacional autorizado foi encontrado.",
    }),
    {
      status: error.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
async function getActiveMasterConfig(supabase: any, clienteId: string, contentType: string) {
  const { data, error } = await supabase.schema('ap').from('master_render_configs').select('*').eq('cliente_id', clienteId).eq('content_type', contentType).eq('enabled', true).maybeSingle();
  if (error) throw error;
  return data || null;
}
async function claimEditorialProcessing(supabase: any, newsId: string) {
  const { data, error } = await supabase.schema('ap').from('candidate_news').update({ processing_started_at: new Date().toISOString() }).eq('id', newsId).eq('status', 'processing').is('processing_started_at', null).select('id').maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { titulo, conteudo, imagem_url: rawImage, image_url: rawImageAlias, cliente_id: requestedClienteId, auth_user_id, url_original, content_type = "feed", userHeadline: rawHeadline, userTag: rawTag, context_tag: rawContextTag, userText: rawText, template_set: rawTemplateSet = "default", placid_template_uuid: manualUuid = null, visual_title_id = null, sponsor_count: rawSponsorCount, idempotency_key = null } = body;
    if (!["feed", "reels"].includes(content_type)) return new Response(JSON.stringify({ error: "VALIDATION_ERROR", message: "content_type inválido" }), { status: 400, headers: corsHeaders });
    if (!titulo || String(titulo).trim().length < 2 || !conteudo || String(conteudo).trim().length < 5) return new Response(JSON.stringify({ error: "VALIDATION_ERROR", message: "titulo e conteudo são obrigatórios" }), { status: 400, headers: corsHeaders });
    const sponsorCountRequested = rawSponsorCount !== undefined && rawSponsorCount !== null && rawSponsorCount !== '';
    const sponsorCount = parseSponsorCount(rawSponsorCount);
    if (sponsorCountRequested && sponsorCount === null) return new Response(JSON.stringify({ error: 'VALIDATION_ERROR', message: 'sponsor_count deve ser 0, 1 ou 2' }), { status: 400, headers: corsHeaders });
    if (sponsorCountRequested && !isUUID(idempotency_key)) return new Response(JSON.stringify({ error: 'VALIDATION_ERROR', message: 'idempotency_key e obrigatorio e deve ser UUID quando sponsor_count for informado' }), { status: 400, headers: corsHeaders });
    if (sponsorCountRequested && manualUuid) return new Response(JSON.stringify({ error: 'VALIDATION_ERROR', message: 'placid_template_uuid manual nao e compativel com sponsor_rotation_v1' }), { status: 400, headers: corsHeaders });

    let authorization;
    try {
      authorization = await authorizeOperationalTenant({
        authorization: req.headers.get("Authorization"),
        requestedClienteId,
        requestedAuthUserId: auth_user_id,
        createUserClient: (token) =>
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
        return tenantAuthorizationErrorResponse(error);
      }
      throw error;
    }
    const cliente_id = authorization.clienteId;
    const authenticatedUserId = authorization.userId;

    // Service role is created only after the caller JWT and requested tenant
    // have both been validated with the user-scoped client above.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Explicit opt-in: existing clients omit sponsor_count and preserve the legacy generator path below.
    if (sponsorCountRequested) {
      const sponsorRotationSet = String(rawTemplateSet || 'default').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(sponsorRotationSet)) return new Response(JSON.stringify({ error: 'VALIDATION_ERROR', message: 'template_set invalido para sponsor_rotation_v1' }), { status: 400, headers: corsHeaders });
      const imageUrlForRotation = rawImage || rawImageAlias || null;
      if (imageUrlForRotation && !isUrl(imageUrlForRotation)) return new Response(JSON.stringify({ error: 'VALIDATION_ERROR', message: 'imagem_url invalida' }), { status: 400, headers: corsHeaders });
      if (!isUUID(visual_title_id)) return new Response(JSON.stringify({ error: 'VALIDATION_ERROR', message: 'visual_title_id e obrigatorio para sponsor_rotation_v1' }), { status: 400, headers: corsHeaders });

      const { data: existingCandidate, error: existingCandidateError } =
        await supabase
          .schema("ap")
          .from("candidate_news")
          .select("id")
          .eq("cliente_id", cliente_id)
          .eq("idempotency_key", idempotency_key)
          .maybeSingle();
      if (existingCandidateError) throw existingCandidateError;

      const userHeadlineForRotation = typeof rawHeadline === 'string' && rawHeadline.trim() ? rawHeadline.trim() : null;
      const userTagForRotation = rawTag || rawContextTag ? String(rawTag || rawContextTag).toUpperCase().trim() : null;
      const userTextForRotation = typeof rawText === 'string' && rawText.trim() ? rawText.trim() : null;
      let renderSnapshotBase: Record<string, unknown> = {};

      // A committed candidate is the source of truth. Retries intentionally
      // skip every live catalog/configuration lookup and let the public RPC
      // compare only the immutable semantic request before returning it.
      if (shouldResolveVisualTitleForCreation(existingCandidate)) {
        try {
          await resolveVisualTitleForCreation(supabase, {
            visualTitleId: visual_title_id,
            clienteId: cliente_id,
            contentType: content_type,
          });
        } catch (error) {
          if (error instanceof VisualTitleResolutionError) {
            return visualTitleErrorResponse(error);
          }
          throw error;
        }

        const { data: control, error: controlError } = await supabase.schema('ap').from('master_render_controls').select('kill_switch').eq('cliente_id', cliente_id).maybeSingle();
        if (controlError) throw controlError;
        if (control?.kill_switch) return new Response(JSON.stringify({ error: 'MASTER_V1_DISABLED', message: 'master_v1 esta bloqueado para este cliente' }), { status: 409, headers: corsHeaders });
        const config = await getActiveMasterConfig(supabase, cliente_id, content_type);
        if (!config?.master_template_uuid || !hasLayerName(config.layer_map, 'visual_title')) return new Response(JSON.stringify({ error: 'MASTER_V1_DISABLED', message: 'Configuracao master_v1 incompleta ou desativada' }), { status: 409, headers: corsHeaders });
        renderSnapshotBase = {
          master_config: { id: config.id, master_template_uuid: config.master_template_uuid, enabled: config.enabled },
          layer_map: config.layer_map,
        };
      }

      const { data: rpcResult, error: rotationError } = await supabase.schema('ap').rpc('create_candidate_with_sponsors', {
        p_cliente_id: cliente_id,
        p_idempotency_key: idempotency_key,
        p_content_type: content_type,
        p_template_set: sponsorRotationSet,
        p_sponsor_count: sponsorCount,
        p_titulo: userHeadlineForRotation || titulo,
        p_conteudo: userTextForRotation || conteudo,
        p_url_original: url_original || null,
        p_imagem_url: imageUrlForRotation,
        p_context_tag: userTagForRotation || 'DESTAQUE',
        p_auth_user_id: authenticatedUserId,
        p_visual_title_id: visual_title_id,
        p_render_contract_version: 'master_v1',
        p_render_snapshot_base: renderSnapshotBase,
      });
      if (rotationError) throw rotationError;
      const news = rpcResult?.candidate_news;
      if (!news?.id) throw new Error('SPONSOR_ROTATION_RPC_INVALID_RESPONSE');
      if (rpcResult.reused && ['pending_render', 'pending_review', 'approved'].includes(news.status)) return new Response(JSON.stringify(responseForNews(news, true)), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (!await claimEditorialProcessing(supabase, news.id)) return new Response(JSON.stringify(responseForNews(news, true)), { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      try {
        const result = await runEditorialWorkflow(supabase, { newsId: news.id, clienteId: cliente_id, userHeadline: userHeadlineForRotation, userTag: userTagForRotation, userText: userTextForRotation, contentType: content_type as any });
        await supabase.schema('ap').from('candidate_news').update({ status: 'pending_render', headline: result.headline, caption: result.caption, context_tag: result.context_tag, roteiro_json: result.roteiro_json, processing_started_at: null }).eq('id', news.id);
        return new Response(JSON.stringify(responseForNews({ ...news, status: 'pending_render', headline: result.headline, caption: result.caption, context_tag: result.context_tag }, Boolean(rpcResult.reused))), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (editorialError) {
        await supabase.schema('ap').from('candidate_news').update({ processing_started_at: null }).eq('id', news.id).eq('status', 'processing');
        throw editorialError;
      }
    }

    const { data: empresa } = await supabase.from("empresas").select("tenant_id").eq("id", cliente_id).maybeSingle();
    let ownerId = empresa?.tenant_id || null;
    if (!ownerId) { const { data: cliente } = await supabase.from("clientes").select("empresa_id").eq("id", cliente_id).maybeSingle(); ownerId = cliente?.empresa_id || cliente_id; }
    const requestedSet = rawTemplateSet || "default";
    let resolved: any = null;
    if (manualUuid) {
      const { data: rows } = await supabase.schema("ap").from("templates").select("id,placid_template_uuid,ordem,nome,template_set").eq("empresa_id", ownerId).eq("tipo", content_type).eq("template_set", requestedSet).eq("placid_template_uuid", manualUuid).limit(2);
      if (rows?.length === 1) resolved = rows[0];
      else if ((rows?.length ?? 0) > 1) console.warn(`[master_v1] manual UUID ${manualUuid} is ambiguous; preserving legacy UUID without template snapshot`);
      else console.warn(`[master_v1] manual UUID ${manualUuid} has no scoped template row; preserving legacy UUID`);
      resolved = resolved || { id: null, placid_template_uuid: manualUuid, ordem: null, nome: null, template_set: requestedSet };
    } else {
      resolved = await rotateTemplate(supabase, ownerId, content_type, requestedSet);
      if (!resolved) return new Response(JSON.stringify({ error: "TEMPLATE_NOT_FOUND", message: "No active template available" }), { status: 400, headers: corsHeaders });
    }
    const imageUrl = rawImage || rawImageAlias || null;
    if (imageUrl && !isUrl(imageUrl)) return new Response(JSON.stringify({ error: "VALIDATION_ERROR", message: "imagem_url inválida" }), { status: 400, headers: corsHeaders });
    let visualTitle: any = null;
    if (visual_title_id) {
      if (!isUUID(visual_title_id)) return new Response(JSON.stringify({ error: "VALIDATION_ERROR", message: "visual_title_id inválido" }), { status: 400, headers: corsHeaders });
      try {
        const title = await resolveVisualTitleForCreation(supabase, {
          visualTitleId: visual_title_id,
          clienteId: cliente_id,
          contentType: content_type,
        });
        visualTitle = title
          ? {
            ...title,
            nome: title.name,
          }
          : null;
      } catch (error) {
        if (error instanceof VisualTitleResolutionError) {
          return visualTitleErrorResponse(error);
        }
        throw error;
      }
    }
    const { data: control } = await supabase.schema("ap").from("master_render_controls").select("kill_switch").eq("cliente_id", cliente_id).maybeSingle();
    const { data: config } = await supabase.schema("ap").from("master_render_configs").select("*").eq("cliente_id", cliente_id).eq("content_type", content_type).eq("enabled", true).maybeSingle();
    let profile: any = null; if (resolved.id) { const { data } = await supabase.schema("ap").from("template_render_profiles").select("*").eq("template_id", resolved.id).eq("ativo", true).maybeSingle(); profile = data; }
    const canMaster = Boolean(!control?.kill_switch && config?.master_template_uuid && config?.layer_map && visualTitle && resolved.id && profile);
    const fallbackReason = canMaster ? null : (!config?.enabled ? "master_disabled" : control?.kill_switch ? "kill_switch" : !visualTitle ? "visual_title_missing" : !resolved.id ? "template_row_unresolved" : !profile ? "profile_missing" : "master_config_invalid");
    const snapshot = { resolved_at: new Date().toISOString(), render_contract_version: canMaster ? "master_v1" : "legacy", format: content_type, template_id: resolved.id, legacy_placid_template_uuid: resolved.placid_template_uuid, template_nome_snapshot: resolved.nome, template_ordem: resolved.ordem, template_set_requested: requestedSet, template_set_effective: resolved.template_set || requestedSet, visual_title: visualTitle, sponsor_profile: profile ? { profile_version: profile.profile_version, slots: profileSlots(profile) } : null, layer_map: config?.layer_map || null, master_config: config ? { id: config.id, master_template_uuid: config.master_template_uuid, enabled: config.enabled } : null, fallback_reason: fallbackReason };
    const userHeadline = typeof rawHeadline === "string" && rawHeadline.trim() ? rawHeadline.trim() : null;
    const userTag = rawTag || rawContextTag ? String(rawTag || rawContextTag).toUpperCase().trim() : null;
    const userText = typeof rawText === "string" && rawText.trim() ? rawText.trim() : null;
    const resolvedTitle = userHeadline || titulo;
    if (!url_original) { const { data: duplicate } = await supabase.schema("ap").from("candidate_news").select("id").eq("cliente_id", cliente_id).eq("titulo", resolvedTitle).eq("conteudo", conteudo).gte("created_at", new Date(Date.now() - 86400000).toISOString()).limit(1); if (duplicate?.length) return new Response(JSON.stringify({ error: "DUPLICATE_ENTRY", message: "Uma matéria idêntica já foi gerada nas últimas 24h." }), { status: 409, headers: corsHeaders }); }
    const { data: news, error: insertError } = await supabase.schema("ap").from("candidate_news").insert(normalize({ cliente_id, titulo: resolvedTitle, conteudo: userText || conteudo, url_original: url_original || null, context_tag: userTag || "DESTAQUE", status: "processing", source: "employee", imagem_url: imageUrl, content_type, criado_por_user_id: authenticatedUserId, role_criador: "employee", generated_by: "employee", origin: "manual", template_id: resolved.id, template_ordem: resolved.ordem, placid_template_uuid: resolved.placid_template_uuid, template_nome_snapshot: resolved.nome, template_set: requestedSet, visual_title_id: visualTitle?.id || null, render_contract_version: snapshot.render_contract_version, render_snapshot: snapshot, gerado_em: new Date().toISOString() })).select("id").single();
    if (insertError) throw insertError;
    const result = await runEditorialWorkflow(supabase, { newsId: news.id, clienteId: cliente_id, userHeadline, userTag, userText, contentType: content_type as any });
    await supabase.schema("ap").from("candidate_news").update({ status: "pending_render", headline: result.headline, caption: result.caption, context_tag: result.context_tag, roteiro_json: result.roteiro_json, processing_started_at: null }).eq("id", news.id);
    return new Response(JSON.stringify({ success: true, news_id: news.id, status: "pending_render", headline: result.headline, caption: result.caption, context_tag: result.context_tag, render_pending: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: any) { return new Response(JSON.stringify({ error: "INTERNAL_ERROR", message: error.message || "Erro interno" }), { status: 400, headers: corsHeaders }); }
});
