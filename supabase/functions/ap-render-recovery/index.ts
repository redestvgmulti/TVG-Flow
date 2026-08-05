// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Render Recovery Worker (With Telemetry)
// Refactored: 2026-03-25 — SRE Observability Implementation.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Telemetry } from "../_shared/telemetry.ts";

const LOCK_EXPIRY_MINUTES = 15;

Deno.serve(async (_req: Request) => {
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const workerId = crypto.randomUUID();
    const telemetry = new Telemetry(supabase);
    await telemetry.logStart({ worker_name: "ap-render-recovery", worker_id: workerId });

    try {
        const expiryCutoff = new Date(Date.now() - LOCK_EXPIRY_MINUTES * 60 * 1000).toISOString();
        const { data: stuckGenerationItems, error: generationSelectionError } =
            await supabase
                .schema("ap")
                .from("candidate_news")
                .select("id")
                .eq("status", "processing")
                .eq("render_contract_version", "territorial_composer_v1")
                .lt("processing_started_at", expiryCutoff)
                .limit(10);
        if (generationSelectionError) throw generationSelectionError;

        let releasedGenerationCount = 0;
        for (const item of stuckGenerationItems || []) {
            const { error } = await supabase.schema("ap").rpc(
                "release_territorial_composer_candidate",
                {
                    p_candidate_id: item.id,
                    p_reason: "GENERATION_LOCK_EXPIRED",
                },
            );
            if (!error) releasedGenerationCount++;
        }

        const { data: stuckItems } = await supabase.schema("ap").from("candidate_news")
            .select("id, render_contract_version, render_attempts, render_started_at")
            .eq("status", "pending_render").is("render_url", null).lt("render_started_at", expiryCutoff).limit(10);

        let recoveredCount = 0;
        for (const item of stuckItems || []) {
            const nextAttempts = (item.render_attempts ?? 0) + 1;
            if (
                item.render_contract_version === "territorial_composer_v1" &&
                nextAttempts > 3
            ) {
                const { error } = await supabase.schema("ap").rpc(
                    "fail_territorial_composer_render",
                    { p_candidate_id: item.id, p_error_code: "RENDER_LOCK_EXPIRED" },
                );
                if (!error) recoveredCount++;
                continue;
            }
            const finalStatus = nextAttempts > 3 ? "failed" : "pending_render";
            const { data } = await supabase.schema("ap").from("candidate_news")
                .update({ status: finalStatus, render_started_at: null, render_attempts: nextAttempts, updated_at: new Date().toISOString() })
                .eq("id", item.id).eq("render_started_at", item.render_started_at).select("id");
            if (data?.length) recoveredCount++;
        }

        const { data: retryItems, error: retrySelectionError } = await supabase
            .schema("ap")
            .from("candidate_news")
            .select("id")
            .eq("status", "failed")
            .eq("render_contract_version", "territorial_composer_v1")
            .is("render_url", null)
            .lt("render_attempts", 3)
            .order("updated_at", { ascending: true })
            .limit(10);
        if (retrySelectionError) throw retrySelectionError;

        let retriedCount = 0;
        for (const item of retryItems || []) {
            const { error } = await supabase.schema("ap").rpc(
                "retry_territorial_composer_render",
                { p_candidate_id: item.id },
            );
            if (!error) retriedCount++;
        }

        await telemetry.logSuccess(0, {
            released_generations: releasedGenerationCount,
            recovered: recoveredCount,
            retried: retriedCount,
        });
        return new Response(JSON.stringify({
            ok: true,
            released_generations: releasedGenerationCount,
            recovered: recoveredCount,
            retried: retriedCount,
        }));
    } catch (err: any) {
        await telemetry.logError(err.message);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
});
