// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Instagram Publisher Worker (With Telemetry)
// Refactored: 2026-03-25 — SRE Observability Implementation.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Telemetry } from "../_shared/telemetry.ts";

const LOCK_EXPIRY_MINUTES = 10;

Deno.serve(async (_req: Request) => {
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const igToken = Deno.env.get("INSTAGRAM_ACCESS_TOKEN");
    const igAccountId = Deno.env.get("INSTAGRAM_BUSINESS_ACCOUNT_ID");
    const workerId = crypto.randomUUID();

    const { data: item } = await supabase
        .schema("ap").from("candidate_news")
        .select("id, caption, render_url, cliente_id")
        .eq("status", "approved")
        .lte("horario_agendado", new Date().toISOString())
        .is("instagram_post_id", null)
        .order("horario_agendado", { ascending: true })
        .limit(1).single();

    if (!item) return new Response(JSON.stringify({ ok: true, published: 0 }));

    const telemetry = new Telemetry(supabase);
    await telemetry.logStart({ worker_name: "ap-instagram-publisher", worker_id: workerId, news_id: item.id, cliente_id: item.cliente_id });

    const lockTime = new Date().toISOString();
    const { data: locked } = await supabase
        .schema("ap").from("candidate_news")
        .update({ processing_started_at: lockTime, worker_id: workerId })
        .eq("id", item.id).eq("status", "approved").is("instagram_post_id", null).select("id");

    if (!locked?.length) { await telemetry.logError("acquire_failed"); return new Response(JSON.stringify({ ok: true })); }

    try {
        // ... (Instagram API calls) ...
        const cRes = await fetch(`https://graph.facebook.com/v22.0/${igAccountId}/media`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_url: item.render_url, caption: item.caption ?? "", access_token: igToken }),
        });
        const { id: containerId } = await cRes.json();
        const pRes = await fetch(`https://graph.facebook.com/v22.0/${igAccountId}/media_publish`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ creation_id: containerId, access_token: igToken }),
        });
        const { id: postId } = await pRes.json();

        await supabase.schema("ap").from("candidate_news").update({
            instagram_post_id: postId, status: "posted", processing_started_at: null, completed_at: new Date().toISOString()
        }).eq("id", item.id).eq("processing_started_at", lockTime);

        await telemetry.logSuccess();
        return new Response(JSON.stringify({ ok: true, published: 1, post_id: postId }));
    } catch (err: any) {
        await supabase.schema("ap").from("candidate_news").update({ processing_started_at: null }).eq("id", item.id).eq("processing_started_at", lockTime);
        await telemetry.logError(err.message);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
});
