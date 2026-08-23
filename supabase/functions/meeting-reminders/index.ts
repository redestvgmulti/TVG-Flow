/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * EDGE FUNCTION: MEETING REMINDERS
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * PURPOSE: Send automated meeting reminders at 60, 30, and 10 minutes before start
 * SCHEDULE: Run every 5 minutes via cron
 * SAFETY: Uses existing RPCs, does not modify database directly
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isTrustedInternalRequest } from '../_shared/internalWorkerAuth.ts'

Deno.serve(async (req) => {
    if (!isTrustedInternalRequest(req)) {
        return new Response(
            JSON.stringify({ error: 'INTERNAL_WORKER_AUTH_REQUIRED' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
        )
    }

    // ✅ OBSERVABILITY: Structured log (execution start)
    const executionId = crypto.randomUUID()
    console.log(JSON.stringify({
        event: 'meeting_reminders_start',
        execution_id: executionId,
        timestamp: new Date().toISOString(),
        source: 'edge_function'
    }))

    try {
        // Initialize Supabase client with service role
        const supabaseUrl = Deno.env.get('SUPABASE_URL')
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

        if (!supabaseUrl || !supabaseServiceKey) {
            // ✅ OBSERVABILITY: Configuration error
            console.error(JSON.stringify({
                event: 'meeting_reminders_config_error',
                execution_id: executionId,
                timestamp: new Date().toISOString(),
                error: 'Missing environment variables'
            }))
            return new Response(
                JSON.stringify({ error: 'Configuration error' }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            )
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        let totalNotificationsSent = 0
        const intervalResults: Record<number, number> = {}

        // Process each reminder interval (60min, 30min, 10min)
        for (const interval of [60, 30, 10]) {
            console.log(JSON.stringify({
                event: 'meeting_reminders_interval_start',
                execution_id: executionId,
                interval_minutes: interval,
                timestamp: new Date().toISOString()
            }))

            // Get meetings that need notifications at this interval
            const { data: notifications, error: fetchError } = await supabase.rpc(
                'get_upcoming_meeting_notifications',
                { interval_minutes: interval }
            )

            if (fetchError) {
                // ✅ OBSERVABILITY: RPC error (non-blocking)
                console.error(JSON.stringify({
                    event: 'meeting_reminders_rpc_error',
                    execution_id: executionId,
                    interval_minutes: interval,
                    error: fetchError.message,
                    timestamp: new Date().toISOString()
                }))
                continue // Don't fail entire job if one interval fails
            }

            const notifCount = notifications?.length || 0
            intervalResults[interval] = notifCount

            console.log(JSON.stringify({
                event: 'meeting_reminders_interval_found',
                execution_id: executionId,
                interval_minutes: interval,
                notifications_count: notifCount,
                timestamp: new Date().toISOString()
            }))

            // Send notification to each participant
            for (const notif of notifications || []) {
                try {
                    const { data, error: notifError } = await supabase.rpc(
                        'create_meeting_notification',
                        {
                            p_reuniao_id: notif.reuniao_id,
                            p_profissional_id: notif.profissional_id,
                            p_titulo: notif.titulo,
                            p_data_inicio: notif.data_inicio,
                            p_interval_minutes: interval
                        }
                    )

                    if (notifError) {
                        // ✅ OBSERVABILITY: Notification error (per-user, non-blocking)
                        console.error(JSON.stringify({
                            event: 'meeting_notification_error',
                            execution_id: executionId,
                            reuniao_id: notif.reuniao_id,
                            interval_minutes: interval,
                            error: notifError.message,
                            timestamp: new Date().toISOString()
                        }))
                    } else if (data) {
                        totalNotificationsSent++
                    }
                } catch (err) {
                    // ✅ OBSERVABILITY: Exception (non-blocking)
                    console.error(JSON.stringify({
                        event: 'meeting_notification_exception',
                        execution_id: executionId,
                        reuniao_id: notif.reuniao_id,
                        interval_minutes: interval,
                        error: err instanceof Error ? err.message : 'Unknown error',
                        timestamp: new Date().toISOString()
                    }))
                }
            }
        }

        // ✅ OBSERVABILITY: Execution complete (success)
        console.log(JSON.stringify({
            event: 'meeting_reminders_complete',
            execution_id: executionId,
            total_notifications_sent: totalNotificationsSent,
            interval_results: intervalResults,
            timestamp: new Date().toISOString(),
            duration_ms: Date.now() - new Date().getTime()
        }))


        return new Response(
            JSON.stringify({
                success: true,
                notifications_sent: totalNotificationsSent,
                interval_results: intervalResults,
                execution_id: executionId,
                timestamp: new Date().toISOString()
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    } catch (error) {
        // ✅ OBSERVABILITY: Fatal error (non-blocking log)
        console.error(JSON.stringify({
            event: 'meeting_reminders_fatal_error',
            execution_id: executionId,
            error: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined,
            timestamp: new Date().toISOString()
        }))

        return new Response(
            JSON.stringify({
                error: 'Internal server error',
                execution_id: executionId,
                details: error instanceof Error ? error.message : 'Unknown error'
            }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        )
    }
})
