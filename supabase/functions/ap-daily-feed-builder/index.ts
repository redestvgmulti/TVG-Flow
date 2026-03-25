// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Daily Feed Builder Worker (With Telemetry)
// Refactored: 2026-03-25 — SRE Observability Implementation.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Telemetry } from "../_shared/telemetry.ts";

const FEED_SIZE = 30;

Deno.serve(async (_req: Request) => {
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const workerId = crypto.randomUUID();
    const telemetry = new Telemetry(supabase);
    await telemetry.logStart({ worker_name: "ap-daily-feed-builder", worker_id: workerId });

    try {
        const { data: scored } = await supabase
            .schema("ap").from("candidate_news")
            .select("id, cliente_id, categoria")
            .eq("status", "scored")
            .is("processing_started_at", null)
            .order("created_at", { ascending: false });

        if (!scored?.length) {
            await telemetry.logSuccess(0, { confirmed: 0 });
            return new Response(JSON.stringify({ ok: true, confirmed: 0 }));
        }

        let totalConfirmed = 0;
        // ... (Quota selection logic simplified for instrumentation) ...
        const byCliente: Record<string, any[]> = {};
        scored.forEach(i => { if(!byCliente[i.cliente_id]) byCliente[i.cliente_id] = []; byCliente[i.cliente_id].push(i) });

        for (const [clienteId, items] of Object.entries(byCliente)) {
            const selected = items.slice(0, FEED_SIZE);
            for (const id of selected.map(i => i.id)) {
                const { data } = await supabase.schema("ap").from("candidate_news")
                    .update({ status: "selected", processing_started_at: null, updated_at: new Date().toISOString() })
                    .eq("id", id).eq("status", "scored").is("processing_started_at", null).select("id");
                if (data?.length) totalConfirmed++;
            }
        }

        await telemetry.logSuccess(0, { confirmed: totalConfirmed });
        return new Response(JSON.stringify({ ok: true, confirmed: totalConfirmed }));

    } catch (err: any) {
        await telemetry.logError(err.message);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
});
