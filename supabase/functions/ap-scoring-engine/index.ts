// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Scoring Engine Worker (With Telemetry)
// Refactored: 2026-03-25 — SRE Observability Implementation.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Telemetry } from "../_shared/telemetry.ts";

const BATCH_LIMIT = 10;
const LOCK_EXPIRY_MINUTES = 10;

Deno.serve(async (_req: Request) => {
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const workerId = crypto.randomUUID();
    const expiryCutoff = new Date(Date.now() - LOCK_EXPIRY_MINUTES * 60 * 1000).toISOString();

    const { data: items } = await supabase
        .schema("ap").from("candidate_news")
        .select("id, cliente_id, categoria")
        .eq("status", "ready_for_scoring")
        .or(`processing_started_at.is.null,processing_started_at.lt.${expiryCutoff}`)
        .order("created_at", { ascending: true })
        .limit(BATCH_LIMIT);

    const processedIds = [];

    for (const item of items ?? []) {
        const telemetry = new Telemetry(supabase);
        await telemetry.logStart({ worker_name: "ap-scoring-engine", worker_id: workerId, news_id: item.id, cliente_id: item.cliente_id });

        const lockTime = new Date().toISOString();
        const { data: locked } = await supabase
            .schema("ap").from("candidate_news")
            .update({ processing_started_at: lockTime })
            .eq("id", item.id)
            .eq("status", "ready_for_scoring")
            .or(`processing_started_at.is.null,processing_started_at.lt.${expiryCutoff}`)
            .select("id");

        if (!locked?.length) {
            await telemetry.logError("acquire_failed");
            continue;
        }

        try {
            await supabase.schema("ap").from("candidate_scores").upsert(
                { news_id: item.id, cliente_id: item.cliente_id, base_score: 5.0 },
                { onConflict: "news_id" }
            );

            await supabase
                .schema("ap").from("candidate_news")
                .update({ status: "scored", processing_started_at: null, updated_at: new Date().toISOString() })
                .eq("id", item.id)
                .eq("processing_started_at", lockTime);

            await telemetry.logSuccess();
            processedIds.push(item.id);

        } catch (err: any) {
            await supabase.schema("ap").from("candidate_news").update({ processing_started_at: null }).eq("id", item.id).eq("processing_started_at", lockTime);
            await telemetry.logError(err.message);
        }
    }

    return new Response(JSON.stringify({ ok: true, processed: processedIds.length }));
});
