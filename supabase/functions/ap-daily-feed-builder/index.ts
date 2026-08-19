import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireTrustedInternalRequest } from "../_shared/internalWorkerAuth.ts";
import { Telemetry } from "../_shared/telemetry.ts";

const FEED_SIZE = 30;
const QUOTAS: Record<string, number> = {
    regional: Math.round(FEED_SIZE * 0.40),
    nacional_relevante: Math.round(FEED_SIZE * 0.35),
    engajamento_alto: Math.round(FEED_SIZE * 0.15),
    global_contextual: FEED_SIZE - Math.round(FEED_SIZE * 0.40) - Math.round(FEED_SIZE * 0.35) - Math.round(FEED_SIZE * 0.15),
};

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
    const telemetry = new Telemetry(supabase);
    await telemetry.logStart({
        worker_name: "ap-daily-feed-builder",
        worker_id: workerId,
        action: "internal_batch",
        metadata: { mode: "internal_batch" },
    });

    try {
        const { data: scored, error: selectionError } = await supabase
            .schema("ap").from("candidate_news")
            .select("id, cliente_id, categoria, candidate_scores(score_total)")
            .eq("status", "scored")
            .order("candidate_scores(score_total)", { ascending: false });
        if (selectionError) throw selectionError;

        if (!scored?.length) {
            await telemetry.logSuccess(0, { mode: "internal_batch", result: "no_items", selected: 0 });
            return new Response(JSON.stringify({ ok: true, selected: 0 }), { headers: { "Content-Type": "application/json" } });
        }

        const byCliente: Record<string, typeof scored> = {};
        for (const item of scored) {
            if (!byCliente[item.cliente_id]) byCliente[item.cliente_id] = [];
            byCliente[item.cliente_id].push(item);
        }

        let totalSelected = 0;
        for (const items of Object.values(byCliente)) {
            const selected: string[] = [];
            const categoryCounts: Record<string, number> = {};

            for (const [category, quota] of Object.entries(QUOTAS)) {
                const categoryItems = items.filter((item) => (item.categoria || "regional") === category);
                for (const item of categoryItems) {
                    if ((categoryCounts[category] ?? 0) >= quota) break;
                    selected.push(item.id);
                    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
                }
            }

            if (selected.length < FEED_SIZE) {
                const fallbackOrder = ["nacional_relevante", "global_contextual", "engajamento_alto", "regional"];
                for (const category of fallbackOrder) {
                    if (selected.length >= FEED_SIZE) break;
                    for (const item of items) {
                        if (selected.includes(item.id) || item.categoria !== category) continue;
                        selected.push(item.id);
                        if (selected.length >= FEED_SIZE) break;
                    }
                }
            }

            for (const id of selected) {
                const { error } = await supabase
                    .schema("ap").from("candidate_news")
                    .update({ status: "selected" })
                    .eq("id", id)
                    .eq("status", "scored");
                if (error) throw error;
            }
            totalSelected += selected.length;
        }

        await telemetry.logSuccess(0, { mode: "internal_batch", result: "success", selected: totalSelected });
        return new Response(JSON.stringify({ ok: true, selected: totalSelected }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch {
        await telemetry.logError("DAILY_FEED_FAILED", 0, { mode: "internal_batch", result: "error" });
        return new Response(JSON.stringify({ error: "DAILY_FEED_FAILED" }), { status: 500 });
    }
});
