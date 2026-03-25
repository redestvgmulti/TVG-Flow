// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Render Engine Worker (With Telemetry & Reels Video API)
// Refactored: 2026-03-25 — Reels Video Integration & Translucency Audit.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Telemetry } from "../_shared/telemetry.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

const BATCH_LIMIT = 5;
const LOCK_EXPIRY_MINUTES = 10;

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const workerId = crypto.randomUUID();
    const renderApiKey = Deno.env.get("RENDER_API_KEY");
    const globalTemplateId = Deno.env.get("RENDER_TEMPLATE_ID");
    const lockExpiryCutoff = new Date(Date.now() - LOCK_EXPIRY_MINUTES * 60 * 1000).toISOString();

    let targetNewsId: string | null = null;
    try {
        if (req.method === "POST") {
            const body = await req.json().catch(() => null);
            if (body?.action === "render_one" && typeof body.newsId === "string") {
                targetNewsId = body.newsId;
            }
        }
    } catch (_) { /* silent */ }

    let query = supabase.schema("ap").from("candidate_news")
        .select("*")
        .eq("status", "pending_render")
        .is("render_url", null)
        .or(`render_started_at.is.null,render_started_at.lt.${lockExpiryCutoff}`)
        .order("created_at", { ascending: true });

    if (targetNewsId) query = query.eq("id", targetNewsId);
    else query = query.limit(BATCH_LIMIT);

    const { data: eligibleItems } = await query;
    const results = [];

    for (const item of eligibleItems ?? []) {
        const isReels = item.content_type === "reels";
        const telemetry = new Telemetry(supabase);
        await telemetry.logStart({
            worker_name: "ap-render-engine",
            worker_id: workerId,
            news_id: item.id,
            cliente_id: item.cliente_id,
            metadata: { content_type: item.content_type }
        });

        const lockTime = new Date().toISOString();
        const { data: lockData } = await supabase
            .schema("ap").from("candidate_news")
            .update({
                render_started_at: lockTime,
                worker_id: workerId,
                render_attempts: (item.render_attempts ?? 0) + 1,
            })
            .eq("id", item.id)
            .eq("status", "pending_render")
            .is("render_url", null)
            .or(`render_started_at.is.null,render_started_at.lt.${lockExpiryCutoff}`)
            .select("id");

        if (!lockData?.length) {
            await telemetry.logError("acquire_failed_lock_contention");
            continue;
        }

        try {
            // 1. Template Selection
            let activeTemplateId = item.placid_template_uuid;
            if (!activeTemplateId) {
                const { data: templateData } = await supabase.rpc("get_and_advance_template", {
                    p_empresa_id: item.cliente_id,
                    p_tipo: item.content_type || "feed",
                    p_template_set: item.template_set || "default"
                });
                activeTemplateId = templateData?.placid_template_uuid || globalTemplateId;
            }
            if (!activeTemplateId || !item.headline) throw new Error("Template or Headline missing.");

            // 2. Build Layers (REELS AUDIT: Skip Image Layer for Reels)
            const layers: Record<string, any> = {
                "headline_news": { text: item.headline },
                "tag_news": { text: item.context_tag || "DESTAQUE" },
            };

            if (!isReels && (item.imagem_url || item.imagem_storage)) {
                layers["news-image"] = { 
                    image: item.imagem_storage 
                        ? `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/ap-images/${item.imagem_storage}` 
                        : item.imagem_url 
                };
            } else if (isReels) {
                console.log(`[Reels-Audit] Enforcing image-free layers for Reels item ${item.id}`);
            }

            // 3. Choice of API Endpoint
            const apiEndpoint = isReels 
                ? "https://api.placid.app/api/rest/videos" 
                : "https://api.placid.app/api/rest/images";

            const renderRes = await fetch(apiEndpoint, {
                method: "POST",
                headers: { "Authorization": `Bearer ${renderApiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ template_uuid: activeTemplateId, layers }),
            });
            
            if (!renderRes.ok) throw new Error(`Placid API error: ${renderRes.status}`);
            const { polling_url } = await renderRes.json();

            // 4. Polling for Completion
            let mediaUrl = null;
            const maxPolls = isReels ? 30 : 15; // Videos take longer
            for (let i = 0; i < maxPolls; i++) {
                await new Promise(r => setTimeout(r, 2000));
                const pollRes = await fetch(polling_url, { headers: { "Authorization": `Bearer ${renderApiKey}` } });
                const pollData = await pollRes.json();
                
                if (pollData.status === "success") {
                    mediaUrl = isReels ? pollData.video_url : pollData.image_url;
                    if (mediaUrl) break;
                } else if (pollData.status === "failed") {
                    throw new Error(`Placid Render Failed: ${pollData.error_message || "Unknown error"}`);
                }
            }
            if (!mediaUrl) throw new Error("Render timeout.");

            // 5. Internalize to Storage
            const dlRes = await fetch(mediaUrl);
            const contentType = dlRes.headers.get("content-type") || (isReels ? "video/mp4" : "image/jpeg");
            const extension = isReels ? "mp4" : (contentType.includes("png") ? "png" : "jpg");
            const storagePath = `${item.cliente_id}/${item.id}.${extension}`;
            
            await supabase.storage.from("ap-renders").upload(storagePath, new Uint8Array(await dlRes.arrayBuffer()), { 
                contentType, 
                upsert: true 
            });
            const publicRenderUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/ap-renders/${storagePath}`;

            // 6. Release (CAS Guard)
            const { data: relData } = await supabase
                .schema("ap").from("candidate_news")
                .update({
                    render_url: publicRenderUrl,
                    render_completed_at: new Date().toISOString(),
                    render_started_at: null,
                    status: "pending_review",
                    worker_id: null
                })
                .eq("id", item.id)
                .eq("render_started_at", lockTime)
                .select("id");

            if (!relData?.length) throw new Error("Release FAILED (Lost Update Lock)");

            const cost = isReels ? 0.10 : 0.05;
            await telemetry.logSuccess(cost, { template_id: activeTemplateId, content_type: item.content_type });
            results.push({ id: item.id, status: "success", url: publicRenderUrl });

        } catch (err: any) {
            console.error(`[Render-Error] Item ${item.id}: ${err.message}`);
            await supabase.schema("ap").from("candidate_news")
                .update({ 
                    render_started_at: null, 
                    error_log: err.message.substring(0, 500) 
                })
                .eq("id", item.id)
                .eq("render_started_at", lockTime);
            
            await telemetry.logError(err.message, 0);
            results.push({ id: item.id, status: "error", error: err.message });
        }
    }

    return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
