// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 12: Learning Engine Worker
// Agrega feedback editorial dos últimos 30 dias para
// calibrar o learning_score do ap-scoring-engine.
// Triggered by: pg_cron (nightly at 23:00)
// verify_jwt: false
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (_req: Request) => {
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const since = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();

    // Fetch all approved/rejected events in the last 30 days
    const { data: history } = await supabase
        .from("ap.learning_history")
        .select("cliente_id, categoria, fonte_id, acao, score_delta")
        .gte("registrado_at", since);

    if (!history?.length) {
        return new Response(JSON.stringify({ ok: true, updated: 0 }), {
            headers: { "Content-Type": "application/json" },
        });
    }

    // Aggregate: average score_delta per (cliente_id, categoria, fonte_id)
    interface AggKey { cliente_id: string; categoria: string; fonte_id: string }
    const agg: Map<string, { sum: number; count: number; keyObj: AggKey }> = new Map();

    for (const row of history) {
        const key = `${row.cliente_id}|${row.categoria}|${row.fonte_id}`;
        const delta = row.acao === "approved" ? Math.abs(row.score_delta ?? 1) : -(Math.abs(row.score_delta ?? 1));

        if (!agg.has(key)) {
            agg.set(key, {
                sum: 0,
                count: 0,
                keyObj: { cliente_id: row.cliente_id, categoria: row.categoria, fonte_id: row.fonte_id },
            });
        }
        const entry = agg.get(key)!;
        entry.sum += delta;
        entry.count++;
    }

    // Update learning_score for scored items matching the aggregated keys
    let updated = 0;
    for (const { sum, count, keyObj } of agg.values()) {
        const avgDelta = count > 0 ? sum / count : 0;

        const { count: rowsUpdated } = await supabase
            .from("ap.candidate_scores")
            .update({ learning_score: avgDelta })
            .eq("cliente_id", keyObj.cliente_id)
            .select("id", { count: "exact", head: true });

        updated += rowsUpdated ?? 0;
    }

    return new Response(JSON.stringify({ ok: true, updated }), {
        headers: { "Content-Type": "application/json" },
    });
});
