// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Content Production Worker (With Telemetry)
// Refactored: 2026-03-25 — SRE Observability Implementation.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { canonicalEditorialFields } from "../_shared/canonicalEditorial.mjs";
import { Telemetry } from "../_shared/telemetry.ts";
import { createAdminClient, requireActiveOperator } from "../_shared/operatorAuth.ts";
import { isTrustedInternalRequest } from "../_shared/internalWorkerAuth.ts";
import {
    authorizeOperationalTenant,
    TenantAuthorizationError,
} from "../ap-employee-generator/tenantAuthorization.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
};

const BATCH_LIMIT = 5;
const LOCK_EXPIRY_MINUTES = 10;
Deno.serve(async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const workerId = crypto.randomUUID();
    const expiryCutoff = new Date(Date.now() - LOCK_EXPIRY_MINUTES * 60 * 1000).toISOString();

    let body: any = {};
    try {
        if (req.method === "POST") body = await req.json().catch(() => ({}));
    } catch (_) { /* silent */ }

    const internalRequest = isTrustedInternalRequest(req);
    const actionType = body.action || "cron";

    let operator: { id: string; email: string } | null = null;
    if (internalRequest && actionType === "approve_for_ig") {
        return new Response(JSON.stringify({ error: "HUMAN_APPROVAL_REQUIRED" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
    if (!internalRequest) {
        try {
            // AutoPublisher exposes these operations to tenant administrators.
            // SERVICE_ROLE below is used only after this user and tenant gate.
            operator = await requireActiveOperator(req, createAdminClient(), ["admin", "super_admin"]);
            if (!["process_studio", "approve_for_ig", "process_selected"].includes(actionType)) {
                return new Response(JSON.stringify({ error: "ACTION_FORBIDDEN" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
            if (!body.newsId) {
                return new Response(JSON.stringify({ error: "RESOURCE_TARGET_REQUIRED" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            }
        } catch (error) {
            const status = error instanceof TenantAuthorizationError
                ? error.status
                : error instanceof Error && error.message.startsWith("UNAUTHORIZED") ? 401 : 403;
            return new Response(JSON.stringify({ error: "AUTHORIZATION_FAILED" }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
    }

    const runTelemetry = new Telemetry(supabase);
    await runTelemetry.logStart({
        worker_name: "ap-content-production",
        worker_id: workerId,
        action: actionType,
        metadata: { mode: internalRequest ? "internal_batch" : "operator_target" },
    });

    let query = supabase.schema("ap").from("candidate_news").select("*");

    if (body.newsId) {
        query = query.eq("id", body.newsId);
    } else {
        query = query
          .or(`processing_started_at.is.null,processing_started_at.lt.${expiryCutoff}`)
          .eq("status", "selected")
          .order("created_at", { ascending: true })
          .limit(BATCH_LIMIT);
    }

    const { data: items, error: selectionError } = await query;
    if (selectionError) {
        await runTelemetry.logError("CONTENT_SELECTION_FAILED", 0, {
            mode: internalRequest ? "internal_batch" : "operator_target",
            result: "error",
        });
        return new Response(JSON.stringify({ error: "CONTENT_SELECTION_FAILED" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (body.newsId && !items?.length) {
        await runTelemetry.logError("NEWS_NOT_FOUND", 0, {
            mode: internalRequest ? "internal_target" : "operator_target",
            result: "not_found",
        });
        return new Response(JSON.stringify({ error: "NEWS_NOT_FOUND" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!internalRequest && body.newsId) {
        try {
            await authorizeOperationalTenant({
                authorization: req.headers.get("Authorization"),
                requestedClienteId: items?.[0]?.cliente_id,
                requestedAuthUserId: null,
                createUserClient: (token) => createClient(
                    Deno.env.get("SUPABASE_URL")!,
                    Deno.env.get("SUPABASE_ANON_KEY")!,
                    { global: { headers: { Authorization: `Bearer ${token}` } } },
                ),
            });
        } catch (error) {
            const status = error instanceof TenantAuthorizationError ? error.status : 403;
            await runTelemetry.logError("TENANT_FORBIDDEN", 0, { mode: "operator_target", result: "forbidden" });
            return new Response(JSON.stringify({ error: "TENANT_FORBIDDEN" }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
    }

    if (actionType === "approve_for_ig") {
        const item = items?.[0];
        if (!item || !operator) {
            await runTelemetry.logError("HUMAN_APPROVAL_REQUIRED", 0, { mode: "operator_target", result: "forbidden" });
            return new Response(JSON.stringify({ error: "HUMAN_APPROVAL_REQUIRED" }), {
                status: 403,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        // Compare-and-set keeps approval human, tenant-authorized and race-safe.
        const approvedAt = new Date().toISOString();
        const { data, error } = await supabase
            .schema("ap").from("candidate_news")
            .update({
                status: "approved",
                approved_by: operator.id,
                approved_by_name: operator.email,
                approved_at: approvedAt,
            })
            .eq("id", item.id)
            .eq("status", "pending_review")
            .is("processing_started_at", null)
            .select("id, status")
            .maybeSingle();

        if (error) {
            await runTelemetry.logError("APPROVAL_FAILED", 0, { mode: "operator_target", result: "error" });
            return new Response(JSON.stringify({ error: "APPROVAL_FAILED" }), {
                status: 500,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
        if (!data) {
            await runTelemetry.logError("APPROVAL_INVALID_STATE", 0, { mode: "operator_target", result: "invalid_state" });
            return new Response(JSON.stringify({ error: "APPROVAL_INVALID_STATE" }), {
                status: 409,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        const telemetry = new Telemetry(supabase);
        await telemetry.logStart({
            worker_name: "ap-content-production",
            worker_id: workerId,
            news_id: item.id,
            cliente_id: item.cliente_id,
            action: "human_approval",
        });
        await telemetry.logSuccess(0, { next_status: "approved", approved_by: operator.id });
        await runTelemetry.logSuccess(0, {
            mode: "operator_target",
            result: "approved",
            processed: 1,
        });
        return new Response(JSON.stringify({ ok: true, results: [{ id: item.id, status: "approved" }] }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const results = [];

    for (const item of items ?? []) {
        const telemetry = new Telemetry(supabase);
        await telemetry.logStart({
            worker_name: "ap-content-production",
            worker_id: workerId,
            news_id: item.id,
            cliente_id: item.cliente_id,
            action: actionType
        });

        const { data: lockData, error: lockError } = await supabase
            .schema("ap")
            .rpc("acquire_content_production_lock", {
                p_candidate_id: item.id,
                p_expected_cliente_id: item.cliente_id,
                p_expected_status: item.status,
                p_expected_processing_started_at: item.processing_started_at,
                p_expected_worker_id: item.worker_id,
                p_worker_id: workerId,
            })
            .maybeSingle();

        if (lockError || !lockData) {
            await telemetry.logError("acquire_failed_lock_contention");
            continue;
        }

        const lockTime = (lockData as any).processing_started_at;
        try {
            const canonical = canonicalEditorialFields(item);
            const isStudio = actionType === "process_studio";
            const nextStatus = isStudio ? "pending_review" : "pending_render";

            const updatePayload: any = {
                status: nextStatus,
                processing_started_at: null,
                completed_at: new Date().toISOString(),
                worker_id: null
            };
            if (isStudio) {
                updatePayload.roteiro_studio = canonical.roteiro_studio;
            } else {
                updatePayload.headline = canonical.headline;
                updatePayload.caption = canonical.caption;
                updatePayload.roteiro_json = canonical.roteiro_json;
                updatePayload.context_tag = canonical.context_tag;
            }

            const { data: relData, error: relErr } = await supabase
                .schema("ap").from("candidate_news")
                .update(updatePayload)
                .eq("id", item.id)
                .eq("processing_started_at", lockTime)
                .select("id");

            if (relErr || !relData?.length) throw new Error("Release FAILED");

            await telemetry.logSuccess(0, { next_status: nextStatus, editorial_source: "persisted_input" });
            results.push({ id: item.id, status: "success" });

        } catch (_err: any) {
            const finalStatus = item.status;

            await supabase.schema("ap").from("candidate_news").update({
                status: finalStatus,
                processing_started_at: null,
                error_log: "CONTENT_PRODUCTION_FAILED"
            }).eq("id", item.id).eq("processing_started_at", lockTime);

            await telemetry.logError("CONTENT_PRODUCTION_FAILED", 0, {
                mode: internalRequest ? "internal_batch" : "operator_target",
                result: "error",
                finalStatus,
            });
            results.push({ id: item.id, status: "error", error: "CONTENT_PRODUCTION_FAILED" });
        }
    }

    await runTelemetry.logSuccess(0, {
        mode: internalRequest ? "internal_batch" : "operator_target",
        result: "completed",
        processed: results.length,
        failures: results.filter((result) => result.status === "error").length,
    });
    return new Response(JSON.stringify({ ok: true, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
