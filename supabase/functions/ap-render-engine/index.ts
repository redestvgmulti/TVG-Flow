import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE" };
const DEFAULT_LAYER_MAP = { news_image: "news-image", headline: "headline_news", tag: "tag_news", visual_title: "tag-png", sponsor_1: "patrocinador-1", sponsor_2: "patrocinador-2" };

function assetUrl(base: string, asset: any) {
  if (!asset || typeof asset !== "object" || !asset.bucket || !asset.path) return null;
  return `${base}/storage/v1/object/public/${asset.bucket}/${asset.path}`;
}
function addImage(layers: Record<string, any>, layer: string | undefined, url: string | null) { if (layer && url) layers[layer] = { image: url }; }

async function resolveMaster(supabase: any, item: any) {
  const snapshot = item.render_snapshot;
  if (!snapshot || snapshot.render_contract_version !== "master_v1" || !item.template_id) return { enabled: false, reason: "snapshot_absent_or_legacy" };
  const { data: control } = await supabase.schema("ap").from("master_render_controls").select("kill_switch").eq("cliente_id", item.cliente_id).maybeSingle();
  if (control?.kill_switch) return { enabled: false, reason: "kill_switch" };
  const { data: configs } = await supabase.schema("ap").from("master_render_configs").select("*").eq("cliente_id", item.cliente_id).eq("content_type", item.content_type || "feed").eq("enabled", true).or(`template_set.eq.${item.template_set || "default"},template_set.is.null`);
  const config = (configs || []).sort((a: any, b: any) => Number(Boolean(b.template_set)) - Number(Boolean(a.template_set)))[0];
  if (!config?.master_template_uuid || !config.layer_map || typeof config.layer_map !== "object" || !config.layer_map.visual_title) return { enabled: false, reason: "master_config_invalid" };
  const title = snapshot.visual_title;
  if (!title?.bucket || !title?.path || !title?.sha256) return { enabled: false, reason: "visual_title_missing" };
  return { enabled: true, config, snapshot };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  const reqBody = await req.json().catch(() => ({}));
  const targetId = reqBody.newsId || reqBody.news_id;
  const lockExpiry = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  let query = supabase.schema("ap").from("candidate_news").select("*").eq("status", "pending_render").is("render_url", null);
  if (targetId) query = query.eq("id", targetId); else query = query.or(`render_started_at.is.null,render_started_at.lt.${lockExpiry}`).limit(5);
  const { data: items } = await query;
  if (!items?.length) return new Response(JSON.stringify({ ok: true, message: "No items" }), { headers: corsHeaders });
  const results = [];
  for (const item of items) {
    const { data: lock } = await supabase.schema("ap").from("candidate_news").update({ render_started_at: new Date().toISOString() }).eq("id", item.id).eq("status", "pending_render").is("render_url", null).select("id");
    if (!lock?.length) continue;
    try {
      let ownerId = item.cliente_id;
      const { data: emp } = await supabase.from("empresas").select("id").eq("id", ownerId).single();
      if (!emp) { const { data: cli } = await supabase.from("clientes").select("empresa_id").eq("id", ownerId).single(); if (cli?.empresa_id) ownerId = cli.empresa_id; }
      let legacyTemplateId = item.placid_template_uuid;
      if (!legacyTemplateId) { const { data: tpl } = await supabase.schema("ap").rpc("get_and_advance_template", { p_empresa_id: ownerId, p_tipo: item.content_type || "feed", p_template_set: item.template_set || "default" }); legacyTemplateId = tpl?.placid_template_uuid; }
      if (!legacyTemplateId) throw new Error("No template");
      const background = item.imagem_url || (item.imagem_storage ? `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/ap-images/${item.imagem_storage}` : null);
      let templateId = legacyTemplateId;
      let layers: Record<string, any> = { "headline_news": { text: item.headline }, "tag_news": { text: item.context_tag || "DESTAQUE" } };
      if (background) layers["news-image"] = { image: background };
      const master = await resolveMaster(supabase, item);
      if (master.enabled) {
        const map = { ...DEFAULT_LAYER_MAP, ...master.config.layer_map };
        const snapshot = master.snapshot;
        const nextLayers: Record<string, any> = {};
        if (item.headline && map.headline) nextLayers[map.headline] = { text: item.headline };
        if (map.tag) nextLayers[map.tag] = { text: item.context_tag || "DESTAQUE" };
        addImage(nextLayers, map.news_image, background);
        addImage(nextLayers, map.visual_title, assetUrl(Deno.env.get("SUPABASE_URL")!, snapshot.visual_title));
        for (const [slot, asset] of Object.entries(snapshot.sponsor_profile?.slots || {})) addImage(nextLayers, map[slot], assetUrl(Deno.env.get("SUPABASE_URL")!, asset));
        templateId = master.config.master_template_uuid;
        layers = nextLayers;
      } else if (item.render_snapshot?.render_contract_version === "master_v1") {
        console.warn(`[master_v1] legacy fallback for ${item.id}: ${master.reason}`);
      }
      const response = await fetch("https://api.placid.app/api/rest/images", { method: "POST", headers: { "Authorization": `Bearer ${Deno.env.get("RENDER_API_KEY")}`, "Content-Type": "application/json" }, body: JSON.stringify({ template_uuid: templateId, layers }) });
      const render = await response.json(); let finalUrl = render.image_url;
      if (!finalUrl && render.polling_url) for (let i = 0; i < 30; i++) { await new Promise(r => setTimeout(r, 2000)); const poll = await fetch(render.polling_url, { headers: { "Authorization": `Bearer ${Deno.env.get("RENDER_API_KEY")}` } }).then(r => r.json()); if (poll.status === "finished") { finalUrl = poll.image_url; break; } if (poll.status === "error") throw new Error(`Placid render error: ${poll.error || "unknown"}`); }
      if (!finalUrl) throw new Error("Render timeout after 60s");
      const download = await fetch(finalUrl); const contentType = download.headers.get("content-type") || "image/jpeg"; const path = `${item.cliente_id}/${item.id}.${contentType.includes("png") ? "png" : "jpg"}`;
      await supabase.storage.from("ap-renders").upload(path, new Uint8Array(await download.arrayBuffer()), { contentType, upsert: true });
      const renderUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/ap-renders/${path}`;
      await supabase.schema("ap").from("candidate_news").update({ render_url: renderUrl, imagem_url: renderUrl, status: "approved", render_started_at: null, completed_at: new Date().toISOString() }).eq("id", item.id);
      results.push({ id: item.id, status: "success", url: renderUrl });
    } catch (error: any) { await supabase.schema("ap").from("candidate_news").update({ status: "failed", error_log: error.message, render_started_at: null }).eq("id", item.id); results.push({ id: item.id, status: "error", error: error.message }); }
  }
  return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});