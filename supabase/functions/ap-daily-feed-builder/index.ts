// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camadas 4+5: Daily Feed Builder
// Seleciona as melhores notícias do dia por quota e fallback editorial.
// Triggered by: pg_cron (once per day at 05:00)
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FEED_SIZE = 30;
// Editorial quotas (Canonical v4 — Fallback Strategy)
const QUOTAS: Record<string, number> = {
    regional: Math.round(FEED_SIZE * 0.40),          // 12
    nacional_relevante: Math.round(FEED_SIZE * 0.35), // 10
    engajamento_alto: Math.round(FEED_SIZE * 0.15),   // 5
    global_contextual: FEED_SIZE - Math.round(FEED_SIZE * 0.40) - Math.round(FEED_SIZE * 0.35) - Math.round(FEED_SIZE * 0.15), // 3
};

Deno.serve(async (_req: Request) => {
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Fetch scored items with their scores — highest score first per category
    const { data: scored } = await supabase
        .from("ap.candidate_news")
        .select("id, cliente_id, categoria, ap_candidate_scores(score_total)")
        .eq("status", "scored")
        .not("categoria", "is", null)
        .order("ap_candidate_scores(score_total)", { ascending: false });

    if (!scored?.length) {
        return new Response(JSON.stringify({ ok: true, selected: 0 }), { headers: { "Content-Type": "application/json" } });
    }

    // Group by cliente_id
    const byCliente: Record<string, typeof scored> = {};
    for (const item of scored) {
        if (!byCliente[item.cliente_id]) byCliente[item.cliente_id] = [];
        byCliente[item.cliente_id].push(item);
    }

    let totalSelected = 0;

    for (const [_clienteId, items] of Object.entries(byCliente)) {
        const selected: string[] = [];
        const categoryCounts: Record<string, number> = {};

        // Fill quotas per category
        for (const [category, quota] of Object.entries(QUOTAS)) {
            const categoryItems = items.filter((i) => i.categoria === category);
            for (const item of categoryItems) {
                if ((categoryCounts[category] ?? 0) >= quota) break;
                selected.push(item.id);
                categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
            }
        }

        // Fallback: fill remaining slots with highest-scored items not yet selected
        if (selected.length < FEED_SIZE) {
            const fallbackOrder = ["nacional_relevante", "global_contextual", "engajamento_alto", "regional"];
            for (const category of fallbackOrder) {
                if (selected.length >= FEED_SIZE) break;
                for (const item of items) {
                    if (selected.includes(item.id)) continue;
                    if (item.categoria !== category) continue;
                    selected.push(item.id);
                    if (selected.length >= FEED_SIZE) break;
                }
            }
        }

        // Advance status for selected items — idempotent
        for (const id of selected) {
            await supabase
                .from("ap.candidate_news")
                .update({ status: "selected" })
                .eq("id", id)
                .eq("status", "scored");
        }

        totalSelected += selected.length;
    }

    return new Response(JSON.stringify({ ok: true, selected: totalSelected }), {
        headers: { "Content-Type": "application/json" },
    });
});
