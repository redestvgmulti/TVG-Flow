// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FlowOS Phase 3 — Async Notifications: Queue Processor Edge Function
// HARDENED: Zero sensitive data leakage + Intelligent pg_cron fallback
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logger } from "../_shared/logger.ts";

Deno.serve(async (req: Request) => {
    const startTime = Date.now();

    try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !supabaseServiceKey) {
            logger.error("config_missing");
            return new Response(
                JSON.stringify({ error: "configuration_error" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false },
        });

        logger.info("processor_start");

        // INTELLIGENT FALLBACK: Only process if pg_cron failed
        const { data: health } = await supabase
            .from("vw_notification_queue_health")
            .select("oldest_age_seconds")
            .eq("status", "pending")
            .single();

        // If queue is healthy (pg_cron working), skip to avoid duplication
        if (!health || (health.oldest_age_seconds && health.oldest_age_seconds < 120)) {
            logger.info("skipped_pg_cron_healthy");
            return new Response(
                JSON.stringify({ skipped: true }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }

        // pg_cron failed or backlog detected → fallback processing
        logger.info("fallback_processing");

        const { error } = await supabase.rpc("process_notification_queue");

        if (error) {
            logger.error("rpc_failed");
            return new Response(
                JSON.stringify({ error: "processing_failed" }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        const duration = Date.now() - startTime;
        logger.metric({ event: "processed", duration_ms: duration });

        return new Response(
            JSON.stringify({ success: true }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    } catch (error) {
        logger.error("unexpected_error");
        return new Response(
            JSON.stringify({ error: "internal_error" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
});
