// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Instagram Publisher Worker (With Telemetry)
// Refactored: 2026-03-25 — SRE Observability Implementation.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Telemetry } from "../_shared/telemetry.ts";
import { isTrustedInternalRequest } from "../_shared/internalWorkerAuth.ts";

const LOCK_EXPIRY_MINUTES = 10;
const BATCH_LIMIT = 20;
const TENANT_TIMEZONE = "America/Sao_Paulo";

// "HH:mm" -> minutes since midnight, for quiet-hours comparisons.
function toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
    return h * 60 + (m || 0);
}

function nowInTenantTimezone(): { minutesOfDay: number; startOfDayIso: string } {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: TENANT_TIMEZONE,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
    const minutesOfDay = parseInt(get("hour"), 10) * 60 + parseInt(get("minute"), 10);
    // Approximate start-of-day in UTC for the tenant's calendar day. Good
    // enough for a daily publish cap — a few minutes of DST/offset slop
    // does not change how many posts went out today.
    const startOfDayIso = `${get("year")}-${get("month")}-${get("day")}T00:00:00-03:00`;
    return { minutesOfDay, startOfDayIso };
}

// Quiet windows can cross midnight (e.g. 23:00 -> 06:00).
function isWithinQuietWindow(minutesOfDay: number, quietStart: string, quietEnd: string): boolean {
    const start = toMinutes(quietStart);
    const end = toMinutes(quietEnd);
    if (start === end) return false;
    if (start < end) return minutesOfDay >= start && minutesOfDay < end;
    return minutesOfDay >= start || minutesOfDay < end;
}

Deno.serve(async (req: Request) => {
    if (!isTrustedInternalRequest(req)) {
        return new Response(JSON.stringify({ error: "INTERNAL_WORKER_AUTH_REQUIRED" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const igToken = Deno.env.get("INSTAGRAM_ACCESS_TOKEN");
    const igAccountId = Deno.env.get("INSTAGRAM_BUSINESS_ACCOUNT_ID");
    const workerId = crypto.randomUUID();

    const { data: candidates } = await supabase
        .schema("ap").from("candidate_news")
        .select("id, caption, render_url, cliente_id")
        .eq("status", "approved")
        .lte("horario_agendado", new Date().toISOString())
        .is("instagram_post_id", null)
        .order("horario_agendado", { ascending: true })
        .limit(BATCH_LIMIT);

    if (!candidates?.length) return new Response(JSON.stringify({ ok: true, published: 0 }));

    const { minutesOfDay, startOfDayIso } = nowInTenantTimezone();
    const configCache = new Map<string, any>();
    const dailyCountCache = new Map<string, number>();

    let item: { id: string; caption: string | null; render_url: string | null; cliente_id: string } | null = null;

    for (const candidate of candidates) {
        if (!candidate.cliente_id) continue;

        if (!configCache.has(candidate.cliente_id)) {
            const { data: config } = await supabase
                .schema("ap").from("system_config")
                .select("publish_on_quiet, quiet_start, quiet_end, daily_cap")
                .eq("cliente_id", candidate.cliente_id)
                .maybeSingle();
            configCache.set(candidate.cliente_id, config);
        }
        const config = configCache.get(candidate.cliente_id);
        if (!config) { item = candidate; break; }

        if (config.publish_on_quiet === false && isWithinQuietWindow(minutesOfDay, config.quiet_start, config.quiet_end)) {
            continue; // this tenant is in its quiet window — try the next candidate
        }

        if (config.daily_cap != null) {
            if (!dailyCountCache.has(candidate.cliente_id)) {
                const { count } = await supabase
                    .schema("ap").from("candidate_news")
                    .select("id", { count: "exact", head: true })
                    .eq("cliente_id", candidate.cliente_id)
                    .eq("status", "posted")
                    .gte("completed_at", startOfDayIso);
                dailyCountCache.set(candidate.cliente_id, count ?? 0);
            }
            if ((dailyCountCache.get(candidate.cliente_id) ?? 0) >= config.daily_cap) {
                continue; // this tenant already hit its daily cap — try the next candidate
            }
        }

        item = candidate;
        break;
    }

    if (!item) return new Response(JSON.stringify({ ok: true, published: 0 }));
    if (!item.cliente_id) {
        return new Response(JSON.stringify({ error: "INVALID_NEWS_TENANT" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

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
