// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Content Production Worker (With Telemetry)
// Refactored: 2026-03-25 — SRE Observability Implementation.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { runEditorialWorkflow } from "../_shared/editorialWorkflow.ts";
import { Telemetry } from "../_shared/telemetry.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

const BATCH_LIMIT = 5;
const LOCK_EXPIRY_MINUTES = 10;
const LLM_RETRY_CAP = 3;
const LLM_COST_ESTIMATE = 0.00015; // GPT-4o-mini rough avg cost

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const workerId = crypto.randomUUID();
    const expiryCutoff = new Date(Date.now() - LOCK_EXPIRY_MINUTES * 60 * 1000).toISOString();

    let body: any = {};
    try {
        if (req.method === "POST") body = await req.json().catch(() => ({}));
    } catch (_) { /* silent */ }

    const actionType = body.action || "cron";
    const userHeadline = body.userHeadline || null;
    const userTag = body.userTag || null;
    const userText = body.userText || null;

    let query = supabase.schema("ap").from("candidate_news").select("*");

    if (body.newsId) {
        query = query.eq("id", body.newsId);
    } else {
        query = query
          .or(`processing_started_at.is.null,processing_started_at.lt.${expiryCutoff}`)
          .in("status", ["selected", "pending_production"])
          .order("created_at", { ascending: true })
          .limit(BATCH_LIMIT);
    }

    const { data: items } = await query;
    const results = [];

    for (const item of items ?? []) {
        const telemetry = new Telemetry(supabase);
        await telemetry.logStart({
            worker_name: "ap-content-production",
            worker_id: workerId,
            news_id: item.id,
            cliente_id: item.cliente_id,
            action: actionType
        });

        const lockTime = new Date().toISOString();
        const { data: lockData } = await supabase
            .schema("ap").from("candidate_news")
            .update({
                processing_started_at: lockTime,
                llm_attempts: (item.llm_attempts || 0) + 1,
                worker_id: workerId
            })
            .eq("id", item.id)
            .or(`processing_started_at.is.null,processing_started_at.lt.${expiryCutoff}`)
            .select("id");

        if (!lockData?.length) {
            await telemetry.logError("acquire_failed_lock_contention");
            continue;
        }

        try {
            const result = await runEditorialWorkflow(supabase, {
                newsId: item.id,
                clienteId: item.cliente_id,
                actionType: (actionType === "process_studio" ? "process_studio" : "standard") as any,
                userHeadline,
                userTag,
                userText,
                contentType: item.content_type || "feed"
            });

            const nextStatus = actionType === "approve_for_ig" ? "pending_render" : "pending_production";
            
            let updatePayload: any = {
                headline: result.headline,
                caption: result.caption,
                roteiro_json: result.roteiro_json,
                context_tag: result.context_tag,
                status: nextStatus,
                processing_started_at: null,
                completed_at: new Date().toISOString(),
                worker_id: null
            };

            const { data: relData, error: relErr } = await supabase
                .schema("ap").from("candidate_news")
                .update(updatePayload)
                .eq("id", item.id)
                .eq("processing_started_at", lockTime)
                .select("id");

            if (relErr || !relData?.length) throw new Error("Release FAILED");

            await telemetry.logSuccess(LLM_COST_ESTIMATE, { next_status: nextStatus });
            results.push({ id: item.id, status: "success" });

        } catch (err: any) {
            const nextAttempts = (item.llm_attempts || 0) + 1;
            const finalStatus = nextAttempts >= LLM_RETRY_CAP ? "failed" : item.status;

            await supabase.schema("ap").from("candidate_news").update({
                status: finalStatus,
                processing_started_at: null,
                error_log: String(err.message).substring(0, 500)
            }).eq("id", item.id).eq("processing_started_at", lockTime);

            await telemetry.logError(err.message, 0, { finalStatus });
            results.push({ id: item.id, status: "error", error: err.message });
        }
    }

    return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
