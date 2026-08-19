import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTrustedInternalRequest } from "../_shared/internalWorkerAuth.ts";
import { Telemetry } from "../_shared/telemetry.ts";

const BATCH_LIMIT = 10;

Deno.serve(async (req: Request) => {
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
    }
    try {
        requireTrustedInternalRequest(req);
    } catch {
        return new Response(JSON.stringify({ error: "INTERNAL_WORKER_AUTH_REQUIRED" }), { status: 401 });
    }

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const workerId = crypto.randomUUID();
    const runTelemetry = new Telemetry(supabase);
    await runTelemetry.logStart({
        worker_name: "ap-scoring-engine",
        worker_id: workerId,
        action: "internal_batch",
        metadata: { mode: "internal_batch" },
    });
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: items } = await supabase
        .schema("ap").from("candidate_news")
        .select("id, cliente_id, titulo, conteudo, imagem_storage, published_at, fonte_id, categoria")
        .eq("status", "ready_for_scoring")
        .or(`processing_started_at.is.null,processing_started_at.lt.${cutoff}`)
        .limit(BATCH_LIMIT);

    let processed = 0;
    for (const item of items ?? []) {
        const telemetry = new Telemetry(supabase);
        await telemetry.logStart({
            worker_name: "ap-scoring-engine",
            worker_id: workerId,
            news_id: item.id,
            cliente_id: item.cliente_id,
            action: "internal_batch",
            metadata: { mode: "internal_batch" },
        });

        const { data: updatedData, error: updateErr } = await supabase
            .schema("ap").from("candidate_news")
            .update({ processing_started_at: new Date().toISOString() })
            .eq("id", item.id)
            .eq("status", "ready_for_scoring")
            .select("id");

        if (updateErr || !updatedData?.length) {
            await telemetry.logError("LOCK_NOT_ACQUIRED", 0, { mode: "internal_batch", result: "lock_contention" });
            continue;
        }

        try {
            const ageHours = item.published_at
                ? (Date.now() - new Date(item.published_at).getTime()) / 3_600_000
                : 24;
            const freshnessScore = Math.max(0, 10 - ageHours / 2.4);
            const imageScore = item.imagem_storage ? 2 : 0;
            const titleLengthScore = item.titulo.length >= 40 && item.titulo.length <= 80 ? 1.5 : 0.5;
            const baseScore = Math.min(10, freshnessScore + imageScore + titleLengthScore);

            const { data: priorityRules } = await supabase
                .schema("ap").from("editorial_rules")
                .select("value")
                .eq("cliente_id", item.cliente_id)
                .eq("rule_type", "priority_topic");

            let priorityBoost = 0;
            if (priorityRules?.length) {
                const searchString = `${item.titulo} ${item.conteudo ?? ""}`.toLowerCase();
                for (const rule of priorityRules) {
                    if (searchString.includes(rule.value.toLowerCase())) {
                        priorityBoost = 5;
                        break;
                    }
                }
            }

            const { data: history } = await supabase
                .schema("ap").from("learning_history")
                .select("score_delta")
                .eq("cliente_id", item.cliente_id)
                .eq("categoria", item.categoria)
                .eq("fonte_id", item.fonte_id)
                .eq("acao", "approved")
                .gte("registrado_at", new Date(Date.now() - 30 * 24 * 3_600_000).toISOString());

            const learningScore = history?.length
                ? history.reduce((sum, row) => sum + (row.score_delta ?? 0), 0) / history.length
                : 0;
            const finalBaseScore = Math.min(10, baseScore + priorityBoost);

            const { error: scoreError } = await supabase.schema("ap").from("candidate_scores").upsert(
                { news_id: item.id, cliente_id: item.cliente_id, base_score: finalBaseScore, learning_score: learningScore },
                { onConflict: "news_id" }
            );
            if (scoreError) throw scoreError;

            const { error: advanceError } = await supabase
                .schema("ap").from("candidate_news")
                .update({ status: "scored", processing_started_at: null })
                .eq("id", item.id)
                .eq("status", "ready_for_scoring");
            if (advanceError) throw advanceError;

            processed++;
            await telemetry.logSuccess(0, { mode: "internal_batch", result: "scored" });
        } catch {
            console.error(`[ap-scoring-engine] item ${item.id}: SCORING_FAILED`);
            await supabase
                .schema("ap").from("candidate_news")
                .update({ processing_started_at: null })
                .eq("id", item.id);
            await telemetry.logError("SCORING_FAILED", 0, { mode: "internal_batch", result: "error" });
        }
    }

    await runTelemetry.logSuccess(0, {
        mode: "internal_batch",
        result: "completed",
        processed,
        failures: (items?.length ?? 0) - processed,
    });
    return new Response(JSON.stringify({ ok: true, processed }), {
        headers: { "Content-Type": "application/json" },
    });
});
