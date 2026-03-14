// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Render Recovery Worker (Cron job)
// Identifica matérias travadas em 'pending_render' e força nova tentativa.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    try {
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

        console.log(`[ap-render-recovery] Buscando matérias travadas antes de: ${fifteenMinutesAgo}`);

        // Busca itens travados (APENAS status='rendering' com processamento estagnado)
        const { data: stuckItems, error: fetchErr } = await supabase
            .schema("ap")
            .from("candidate_news")
            .select("id, retry_count")
            .eq("status", "rendering")
            .lt("processing_started_at", fifteenMinutesAgo);

        if (fetchErr) throw fetchErr;

        if (!stuckItems || stuckItems.length === 0) {
            return new Response(JSON.stringify({ ok: true, message: "No stuck items found" }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
        }

        console.log(`[ap-render-recovery] Encontrados ${stuckItems.length} itens travados. Iniciando recuperação...`);

        const results = [];

        for (const item of stuckItems) {
            console.log(`[ap-render-recovery] Recuperando item: ${item.id} (Tentativa ${item.retry_count + 1})`);

            const newRetryCount = (item.retry_count || 0) + 1;
            const finalStatus = newRetryCount >= 3 ? "failed_render" : "pending_render";

            // 1. Atualizar status e resetar worker
            const { error: updErr } = await supabase
                .schema("ap")
                .from("candidate_news")
                .update({
                    status: finalStatus,
                    worker_id: null,
                    retry_count: newRetryCount,
                    processing_started_at: null,
                    updated_at: new Date().toISOString()
                })
                .eq("id", item.id);

            if (updErr) {
                console.error(`[ap-render-recovery] Erro ao atualizar item ${item.id}:`, updErr);
                results.push({ id: item.id, status: "error", error: updErr.message });
                continue;
            }

            // 2. Disparar o render_one no ap-render-engine apenas se não falhou permanentemente
            if (finalStatus === "pending_render") {
                try {
                    const renderRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ap-render-engine`, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ action: "render_one", newsId: item.id })
                    });
    
                    if (renderRes.ok) {
                        console.log(`[ap-render-recovery] Trigger render_one executado para: ${item.id}`);
                        results.push({ id: item.id, status: "recovered" });
                    } else {
                        const errText = await renderRes.text();
                        console.error(`[ap-render-recovery] Falha ao disparar render_one para ${item.id}: ${errText}`);
                        results.push({ id: item.id, status: "trigger_failed", error: errText });
                    }
                } catch (triggerErr: any) {
                    console.error(`[ap-render-recovery] Exception no trigger para ${item.id}:`, triggerErr);
                    results.push({ id: item.id, status: "trigger_exception", error: triggerErr.message });
                }
            } else {
                console.log(`[ap-render-recovery] Item ${item.id} marcado como failed_render (excedeu tentativas).`);
                results.push({ id: item.id, status: "failed_permanently" });
            }
        }

        return new Response(JSON.stringify({ ok: true, processed: stuckItems.length, results }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

    } catch (err: any) {
        console.error("[ap-render-recovery] Fatal error:", err);
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
    }
});
