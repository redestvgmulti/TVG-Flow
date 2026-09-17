// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Instagram Publisher Worker (With Telemetry)
// Refactored: 2026-03-25 — SRE Observability Implementation.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { publishLegacyFeed, supabasePublicationStore } from "./publicationWorkflow.mjs";
import { Telemetry } from "../_shared/telemetry.ts";
import { isTrustedInternalRequest } from "../_shared/internalWorkerAuth.ts";


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
    if (req.method !== "POST") return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
    if (!isTrustedInternalRequest(req)) {
        return new Response(JSON.stringify({ error: "INTERNAL_WORKER_AUTH_REQUIRED" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    if (Deno.env.get("AP_LEGACY_PUBLISH_ENABLED") !== "true") {
        return new Response(JSON.stringify({ ok: true, disabled: true, published: 0 }));
    }
    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const igToken = Deno.env.get("INSTAGRAM_ACCESS_TOKEN");
    const igAccountId = Deno.env.get("INSTAGRAM_BUSINESS_ACCOUNT_ID");
    const workerId = crypto.randomUUID();

    const { data: candidates, error: selectionError } = await supabase
        .schema("ap").rpc("p0_list_publish_candidates", { p_limit: BATCH_LIMIT });

    if (selectionError) return new Response(JSON.stringify({ error: "PUBLICATION_SELECTION_FAILED", published: 0 }), { status: 500 });
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

    try {
        const result = await publishLegacyFeed({
            store: supabasePublicationStore(supabase), candidateId: item.id,
            accountId: igAccountId, token: igToken,
        });
        if (result.outcome === "posted") await telemetry.logSuccess(0, result);
        else if (result.outcome === "not_claimed") await telemetry.logSuccess(0, result);
        else await telemetry.logError(result.error || result.outcome, 0, result);
        return new Response(JSON.stringify({ ...result, published: result.outcome === "posted" ? 1 : 0 }), {
            status: result.outcome === "reconciliation_required" ? 409 : 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch {
        await telemetry.logError("PUBLICATION_STOPPED_DATABASE_OR_CONFIGURATION_ERROR");
        return new Response(JSON.stringify({ error: "PUBLICATION_STOPPED", published: 0 }), { status: 500 });
    }
});
