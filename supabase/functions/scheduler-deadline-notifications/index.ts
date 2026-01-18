/**
 * Edge Function: scheduler-deadline-notifications
 * 
 * PURPOSE: Send smart deadline reminders for micro tasks
 * TRIGGER: External scheduler (GitHub Actions or cron)
 * FREQUENCY: Every 5 minutes
 * STRATEGY: Micro-task-first (professionals notified for their tasks only)
 * 
 * INTERVALS:
 * - 60 minutes before deadline: ⏰ "Sua tarefa vence em 1 hora"
 * - 30 minutes before deadline: ⚠️ "Sua tarefa vence em 30 minutos"
 * - 15 minutes before deadline: 🔴 "URGENTE: Sua tarefa vence em 15 minutos"
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DeadlineNotification {
    micro_task_id: string
    profissional_id: string
    profissional_nome: string
    funcao: string
    macro_task_titulo: string
    deadline_at: string
    minutes_until_deadline: number
    notification_interval: number
}

interface NotificationResult {
    interval: number
    count: number
    notifications_sent: number
    errors: number
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        console.log('[Deadline Notifications] Starting scheduler run...')

        // Create Supabase client with service role
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        const results: NotificationResult[] = []

        // Process notifications for each interval
        const intervals = [60, 30, 15] // minutes before deadline

        for (const interval of intervals) {
            console.log(`[Deadline Notifications] Checking ${interval}min interval...`)

            const result: NotificationResult = {
                interval,
                count: 0,
                notifications_sent: 0,
                errors: 0
            }

            try {
                // Get tasks needing notifications for this interval
                const { data: tasks, error: fetchError } = await supabase
                    .rpc('get_upcoming_deadline_notifications', { interval_minutes: interval })

                if (fetchError) {
                    console.error(`[${interval}min] Error fetching tasks:`, fetchError)
                    result.errors++
                    results.push(result)
                    continue
                }

                result.count = tasks?.length || 0
                console.log(`[${interval}min] Found ${result.count} tasks needing notifications`)

                if (!tasks || tasks.length === 0) {
                    results.push(result)
                    continue
                }

                // STAGE 2 FIX: Prepare bulk payload
                // Move message generation logic here (from SQL) to support generic bulk insert
                const payloads = (tasks as DeadlineNotification[]).map(task => {
                    let icon = '⏰'
                    let message = ''
                    let urgency = 'low'

                    if (interval === 60) {
                        icon = '⏰'
                        message = `${icon} Sua tarefa "${task.funcao}" vence em 1 hora`
                        urgency = 'low'
                    } else if (interval === 30) {
                        icon = '⚠️'
                        message = `${icon} Sua tarefa "${task.funcao}" vence em 30 minutos`
                        urgency = 'medium'
                    } else if (interval === 15) {
                        icon = '🔴'
                        message = `${icon} URGENTE: Sua tarefa "${task.funcao}" vence em 15 minutos!`
                        urgency = 'high'
                    } else {
                        message = `Lembrete: Sua tarefa "${task.funcao}" está próxima do prazo`
                    }

                    return {
                        profissional_id: task.profissional_id,
                        message: message,
                        metadata: {
                            micro_task_id: task.micro_task_id,
                            funcao: task.funcao,
                            macro_task_titulo: task.macro_task_titulo,
                            deadline_at: task.deadline_at,
                            interval_minutes: interval,
                            urgency: urgency
                        }
                    }
                })

                // Execute Bulk Insert (RPC)
                console.log(`[${interval}min] Sending bulk payload of ${payloads.length} notifications...`)

                const { data: bulkResult, error: bulkError } = await supabase
                    .rpc('bulk_create_deadline_notifications', { payloads })

                if (bulkError) {
                    console.error(`[${interval}min] Bulk insert error:`, bulkError)
                    result.errors += payloads.length
                } else {
                    const inserted = (bulkResult as any)?.inserted || 0
                    console.log(`[${interval}min] ✓ Bulk success: ${inserted} notifications created`)
                    result.notifications_sent += inserted
                }

            } catch (intervalError) {
                console.error(`[${interval}min] Interval processing error:`, intervalError)
                result.errors++
            }

            results.push(result)
        }

        // Summary
        const totalSent = results.reduce((sum, r) => sum + r.notifications_sent, 0)
        const totalErrors = results.reduce((sum, r) => sum + r.errors, 0)

        console.log('[Deadline Notifications] Run complete:')
        console.log(`  - Total notifications sent: ${totalSent}`)
        console.log(`  - Total errors: ${totalErrors}`)
        console.log('  - Results by interval:', JSON.stringify(results, null, 2))

        return new Response(
            JSON.stringify({
                success: true,
                message: 'Deadline notifications processed',
                results,
                summary: {
                    total_sent: totalSent,
                    total_errors: totalErrors,
                    timestamp: new Date().toISOString()
                }
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            }
        )

    } catch (error) {
        console.error('[Deadline Notifications] Fatal error:', error)

        return new Response(
            JSON.stringify({
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500
            }
        )
    }
})
