// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Camada 11: Instagram Publisher Worker
// Publica uma notícia por execução via Instagram Graph API.
// Anti-repost: guard AND instagram_post_id IS NULL
// Triggered by: pg_cron (every 5 min)
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

    const igToken = Deno.env.get("INSTAGRAM_ACCESS_TOKEN");
    const igAccountId = Deno.env.get("INSTAGRAM_BUSINESS_ACCOUNT_ID");

    if (!igToken || !igAccountId) {
        return new Response(
            JSON.stringify({ error: "Instagram credentials not configured" }),
            { status: 500 }
        );
    }

    // Anti-repost guard: AND instagram_post_id IS NULL
    // Self-healing: OR processing_started_at older than 10min
    const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const { data: item } = await supabase
        .from("ap.candidate_news")
        .select("id, caption, render_url, instagram_post_id")
        .eq("status", "queued_for_posting")
        .lte("horario_agendado", now)
        .is("instagram_post_id", null)             // Anti-repost guard
        .or(`processing_started_at.is.null,processing_started_at.lt.${cutoff}`)
        .order("horario_agendado", { ascending: true })
        .limit(1)
        .single();

    if (!item) {
        return new Response(JSON.stringify({ ok: true, published: 0 }), {
            headers: { "Content-Type": "application/json" },
        });
    }

    // Lock the item
    const { count } = await supabase
        .from("ap.candidate_news")
        .update({ processing_started_at: new Date().toISOString() })
        .eq("id", item.id)
        .eq("status", "queued_for_posting")
        .is("instagram_post_id", null)
        .select("id", { count: "exact", head: true });

    if (!count) {
        return new Response(JSON.stringify({ ok: true, published: 0, reason: "item_taken" }), {
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        if (!item.render_url) throw new Error("No render_url available");

        // Step 1: Create container
        const containerRes = await fetch(
            `https://graph.facebook.com/v22.0/${igAccountId}/media`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    image_url: item.render_url,
                    caption: item.caption ?? "",
                    access_token: igToken,
                }),
            }
        );
        if (!containerRes.ok) throw new Error(`Container create failed: ${containerRes.status}`);
        const { id: containerId } = await containerRes.json();

        // Step 2: Publish container
        const publishRes = await fetch(
            `https://graph.facebook.com/v22.0/${igAccountId}/media_publish`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ creation_id: containerId, access_token: igToken }),
            }
        );
        if (!publishRes.ok) throw new Error(`Publish failed: ${publishRes.status}`);
        const { id: postId } = await publishRes.json();

        // Advance status — idempotent, clears processing lock
        await supabase
            .from("ap.candidate_news")
            .update({
                instagram_post_id: postId,
                status: "posted",
                processing_started_at: null,
            })
            .eq("id", item.id)
            .eq("status", "queued_for_posting");

        return new Response(JSON.stringify({ ok: true, published: 1, post_id: postId }), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        console.error(`[ap-instagram-publisher] item ${item.id}:`, err);
        // Clear lock so self-healing retries after 10min
        await supabase
            .from("ap.candidate_news")
            .update({ processing_started_at: null })
            .eq("id", item.id);

        return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
    }
});
