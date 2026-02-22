// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 8: Render Engine Worker
// Chama API de render (Placid/Bannerbear) e salva imagem final.
// Triggered by: pg_cron (every 20 min)
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH_LIMIT = 5;

Deno.serve(async (_req: Request) => {
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const renderApiKey = Deno.env.get("RENDER_API_KEY");
    const renderTemplateId = Deno.env.get("RENDER_TEMPLATE_ID");

    if (!renderApiKey || !renderTemplateId) {
        return new Response(JSON.stringify({ error: "RENDER_API_KEY or RENDER_TEMPLATE_ID not configured" }), { status: 500 });
    }

    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: items } = await supabase
        .from("ap.candidate_news")
        .select("id, cliente_id, headline, imagem_storage, patrocinador_id")
        .eq("status", "pending_render")
        .or(`processing_started_at.is.null,processing_started_at.lt.${cutoff}`)
        .limit(BATCH_LIMIT);

    for (const item of items ?? []) {
        // Lock
        const { count } = await supabase
            .from("ap.candidate_news")
            .update({ processing_started_at: new Date().toISOString() })
            .eq("id", item.id)
            .eq("status", "pending_render")
            .select("id", { count: "exact", head: true });

        if (!count) continue;

        try {
            // Atomic sponsor selection (FOR UPDATE SKIP LOCKED inside function)
            const { data: sponsorId } = await supabase.rpc("select_sponsor", {
                p_cliente_id: item.cliente_id,
            });

            // Build render request — supports Placid/Bannerbear-style API
            const imageStorageUrl = item.imagem_storage
                ? `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/ap-images/${item.imagem_storage}`
                : null;

            const renderPayload = {
                template: renderTemplateId,
                layers: {
                    headline: { text: item.headline ?? "" },
                    ...(imageStorageUrl ? { background: { image_url: imageStorageUrl } } : {}),
                },
            };

            const renderRes = await fetch("https://api.placid.app/api/rest/images", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${renderApiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(renderPayload),
            });

            if (!renderRes.ok) throw new Error(`Render API error: ${renderRes.status}`);
            const renderData = await renderRes.json();
            const renderUrl = renderData.image_url ?? renderData.url;

            await supabase
                .from("ap.candidate_news")
                .update({
                    render_url: renderUrl,
                    patrocinador_id: sponsorId ?? null,
                    status: "pending_review",
                    processing_started_at: null,
                })
                .eq("id", item.id)
                .eq("status", "pending_render");
        } catch (err) {
            console.error(`[ap-render-engine] item ${item.id}:`, err);
            await supabase
                .from("ap.candidate_news")
                .update({ processing_started_at: null })
                .eq("id", item.id);
        }
    }

    return new Response(JSON.stringify({ ok: true, processed: items?.length ?? 0 }), {
        headers: { "Content-Type": "application/json" },
    });
});
