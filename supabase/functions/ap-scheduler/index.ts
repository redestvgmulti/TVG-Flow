// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 10: Scheduler Worker
// Agenda notícias aprovadas em slots disponíveis do dia.
// Triggered by: Frontend (POST after human review approval)
// verify_jwt: true
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Valid posting windows (hour ranges in local BRT/UTC-3)
const POSTING_WINDOWS = [
    { start: 7, end: 9 },
    { start: 11.5, end: 14 },
    { start: 17.5, end: 20.5 },
    { start: 21, end: 22.5 },
];

// Anti-shadowban: random interval 22-37 minutes
function randomIntervalMs(): number {
    return (22 + Math.random() * 15) * 60 * 1000;
}

function inWindow(date: Date): boolean {
    const hours = date.getUTCHours() - 3; // BRT offset
    const h = ((hours % 24) + 24) % 24;
    return POSTING_WINDOWS.some((w) => h >= w.start && h < w.end);
}

Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    let news_id: string;
    try {
        const body = await req.json();
        news_id = body.news_id;
        if (!news_id) throw new Error("Missing news_id");
    } catch {
        return new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers: corsHeaders });
    }

    // Guard: item must be 'approved' and not already scheduled
    const { data: item } = await supabase
        .from("ap.candidate_news")
        .select("id, cliente_id, horario_agendado, status")
        .eq("id", news_id)
        .eq("status", "approved")
        .is("horario_agendado", null)
        .single();

    if (!item) {
        return new Response(
            JSON.stringify({ error: "item_not_found_or_already_scheduled" }),
            { status: 404, headers: corsHeaders }
        );
    }

    // Get last scheduled slot for this client today
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const { data: lastScheduled } = await supabase
        .from("ap.candidate_news")
        .select("horario_agendado")
        .eq("cliente_id", item.cliente_id)
        .eq("status", "queued_for_posting")
        .gte("horario_agendado", today.toISOString())
        .order("horario_agendado", { ascending: false })
        .limit(1)
        .single();

    // Calculate next available slot
    const baseTime = lastScheduled?.horario_agendado
        ? new Date(lastScheduled.horario_agendado).getTime() + randomIntervalMs()
        : Date.now() + randomIntervalMs();

    let nextSlot = new Date(baseTime);

    // Ensure slot falls inside a posting window (BRT)
    let attempts = 0;
    while (!inWindow(nextSlot) && attempts < 100) {
        nextSlot = new Date(nextSlot.getTime() + 5 * 60 * 1000);
        attempts++;
    }

    // Idempotent update — WHERE horario_agendado IS NULL ensures no overwrite
    const { error } = await supabase
        .from("ap.candidate_news")
        .update({ horario_agendado: nextSlot.toISOString(), status: "queued_for_posting" })
        .eq("id", item.id)
        .eq("status", "approved")
        .is("horario_agendado", null);

    if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(
        JSON.stringify({ ok: true, scheduled_at: nextSlot.toISOString() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
});
