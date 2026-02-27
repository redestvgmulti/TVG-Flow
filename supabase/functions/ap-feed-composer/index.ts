// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 6: Feed Composer Worker
// Ordena o feed do dia aplicando regras de sequência editoriais.
// Triggered by: pg_cron (once per day at 06:00, after feed builder)
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

    // Fetch all selected items, grouped by cliente_id
    const { data: items } = await supabase
        .schema("ap").from("candidate_news")
        .select("id, cliente_id, categoria, fonte_id, has_face")
        .eq("status", "selected")
        .order("cliente_id");

    if (!items?.length) {
        return new Response(JSON.stringify({ ok: true, composed: 0 }), { headers: { "Content-Type": "application/json" } });
    }

    // Group by cliente_id
    const byCliente: Record<string, typeof items> = {};
    for (const item of items) {
        if (!byCliente[item.cliente_id]) byCliente[item.cliente_id] = [];
        byCliente[item.cliente_id].push(item);
    }

    let totalComposed = 0;

    for (const clienteItems of Object.values(byCliente)) {
        const ordered = sequenceItems(clienteItems);

        // Update posicao_feed — idempotent (can run N times, result is same)
        for (let i = 0; i < ordered.length; i++) {
            await supabase
                .schema("ap").from("candidate_news")
                .update({ posicao_feed: i + 1 })
                .eq("id", ordered[i].id)
                .eq("status", "selected");
        }

        totalComposed += ordered.length;
    }

    return new Response(JSON.stringify({ ok: true, composed: totalComposed }), {
        headers: { "Content-Type": "application/json" },
    });
});

// Sequencing rules:
// 1. Never two consecutive items of same category
// 2. Never two consecutive items from same source
// 3. Max 1 has_face item every 3 positions
function sequenceItems(items: { id: string; categoria: string | null; fonte_id: string | null; has_face: boolean }[]) {
    const remaining = [...items];
    const ordered: typeof items = [];

    while (remaining.length > 0) {
        const last = ordered[ordered.length - 1];
        const secondLast = ordered[ordered.length - 2];

        // Count consecutive faces in last 2 positions
        const recentFaces = ordered.slice(-2).filter((i) => i.has_face).length;

        const candidate = remaining.find((item) => {
            if (last && item.categoria === last.categoria) return false;
            if (last && item.fonte_id && item.fonte_id === last.fonte_id) return false;
            if (last && secondLast && item.categoria === secondLast.categoria) return false;
            if (item.has_face && recentFaces >= 1) return false;
            return true;
        });

        if (candidate) {
            ordered.push(candidate);
            remaining.splice(remaining.indexOf(candidate), 1);
        } else {
            // No ideal candidate — just take first to avoid infinite loop
            ordered.push(remaining[0]);
            remaining.shift();
        }
    }

    return ordered;
}
