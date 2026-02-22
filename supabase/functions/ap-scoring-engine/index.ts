// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 3: Scoring Engine Worker
// Calcula score heurístico + learning score adaptativo. Sem IA.
// Triggered by: pg_cron (every 15 min)
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BATCH_LIMIT = 10;

Deno.serve(async (_req: Request) => {
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Select items in 'ready_for_scoring' — with self-healing
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: items } = await supabase
        .from("ap.candidate_news")
        .select("id, cliente_id, titulo, conteudo, imagem_storage, published_at, fonte_id, categoria")
        .eq("status", "ready_for_scoring")
        .or(`processing_started_at.is.null,processing_started_at.lt.${cutoff}`)
        .limit(BATCH_LIMIT);

    for (const item of items ?? []) {
        // Lock the item
        const { count } = await supabase
            .from("ap.candidate_news")
            .update({ processing_started_at: new Date().toISOString() })
            .eq("id", item.id)
            .eq("status", "ready_for_scoring")
            .select("id", { count: "exact", head: true });

        if (!count) continue; // Already taken

        try {
            // Heuristic base score (0-10)
            const ageHours = item.published_at
                ? (Date.now() - new Date(item.published_at).getTime()) / 3_600_000
                : 24;
            const freshnessScore = Math.max(0, 10 - ageHours / 2.4); // 0-10 over 24h
            const imageScore = item.imagem_storage ? 2 : 0;
            const titleLengthScore = item.titulo.length >= 40 && item.titulo.length <= 80 ? 1.5 : 0.5;
            const base_score = Math.min(10, freshnessScore + imageScore + titleLengthScore);

            // Learning score: average of approved items from same categoria+fonte in last 30 days
            const { data: history } = await supabase
                .from("ap.learning_history")
                .select("score_delta")
                .eq("cliente_id", item.cliente_id)
                .eq("categoria", item.categoria)
                .eq("fonte_id", item.fonte_id)
                .eq("acao", "approved")
                .gte("registrado_at", new Date(Date.now() - 30 * 24 * 3_600_000).toISOString());

            const learning_score =
                history && history.length > 0
                    ? history.reduce((sum, h) => sum + (h.score_delta ?? 0), 0) / history.length
                    : 0;

            // Upsert score — idempotent
            await supabase.from("ap.candidate_scores").upsert(
                { news_id: item.id, cliente_id: item.cliente_id, base_score, learning_score },
                { onConflict: "news_id" }
            );

            // Advance status — idempotent
            await supabase
                .from("ap.candidate_news")
                .update({ status: "scored", processing_started_at: null })
                .eq("id", item.id)
                .eq("status", "ready_for_scoring");
        } catch (err) {
            console.error(`[ap-scoring-engine] item ${item.id}:`, err);
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
