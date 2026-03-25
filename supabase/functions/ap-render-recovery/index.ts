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
        const { data: stuckItems } = await supabase.schema("ap").from("candidate_news")
            .select("id, render_attempts, render_started_at")
            .eq("status", "pending_render").is("render_url", null).lt("render_started_at", expiryCutoff).limit(10);

        if (!stuckItems?.length) { await telemetry.logSuccess(0, { recovered: 0 }); return new Response(JSON.stringify({ ok: true })); }

        let recoveredCount = 0;
        for (const item of stuckItems) {
            const nextAttempts = (item.render_attempts ?? 0) + 1;
            const finalStatus = nextAttempts > 3 ? "failed" : "pending_render";
            const { data } = await supabase.schema("ap").from("candidate_news")
                .update({ status: finalStatus, render_started_at: null, render_attempts: nextAttempts, updated_at: new Date().toISOString() })
                .eq("id", item.id).eq("render_started_at", item.render_started_at).select("id");
            if (data?.length) recoveredCount++;
        }

        await telemetry.logSuccess(0, { recovered: recoveredCount });
        return new Response(JSON.stringify({ ok: true, recovered: recoveredCount }));
    } catch (err: any) {
        await telemetry.logError(err.message);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
});
