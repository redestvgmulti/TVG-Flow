import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseKey)

        // 1. Get all overdue tasks using the view
        const { data: overdueTasks, error: tasksError } = await supabase
            .from('tarefas_com_status_real')
            .select(`
                id,
                titulo,
                deadline,
                assigned_to,
                cliente_id,
                is_overdue,
                hours_overdue
            `)
            .eq('is_overdue', true)

        if (tasksError) throw tasksError

        if (!overdueTasks || overdueTasks.length === 0) {
            return new Response(JSON.stringify({ message: 'No overdue tasks' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 200
            })
        }

        let notificationsSent = 0

        for (const task of overdueTasks) {
            // Check if we already sent notification in the last hour
            const { data: lastLog } = await supabase
                .from('overdue_notifications_log')
                .select('last_notified_at')
                .eq('tarefa_id', task.id)
                .single()

            const now = new Date()

            // Only send if more than 1 hour has passed since last notification
            if (lastLog) {
                const lastNotified = new Date(lastLog.last_notified_at)
                const hoursSinceLastNotif = (now.getTime() - lastNotified.getTime()) / (1000 * 60 * 60)

                if (hoursSinceLastNotif < 1) {
                    continue // Skip, already notified recently
                }
            }

            // Get recipients: professional + company managers + admins
            const recipients = []

            // 1. Assigned professional
            if (task.assigned_to) {
                recipients.push(task.assigned_to)
            }

            // 2. Company managers (professionals with role admin for this company)
            const { data: managers } = await supabase
                .from('empresa_profissionais')
                .select('profissional_id, profissionais!inner(role)')
                .eq('empresa_id', task.cliente_id)
                .eq('ativo', true)
                .eq('profissionais.role', 'admin')

            if (managers) {
                managers.forEach(m => recipients.push(m.profissional_id))
            }

            // 3. System admins
            const { data: admins } = await supabase
                .from('profissionais')
                .select('id')
                .eq('role', 'admin')
                .eq('ativo', true)

            if (admins) {
                admins.forEach(a => recipients.push(a.id))
            }

            // Remove duplicates
            const uniqueRecipients = [...new Set(recipients)]

            // Create notification message (NO EMOJIS)
            const hoursOverdue = Math.floor(task.hours_overdue)
            const message = `A tarefa "${task.titulo}" está atrasada há ${hoursOverdue} ${hoursOverdue === 1 ? 'hora' : 'horas'}.`

            // Send notification to each recipient
            for (const recipientId of uniqueRecipients) {
                const { error: notifError } = await supabase
                    .from('notifications')
                    .insert({
                        profissional_id: recipientId,
                        title: 'Tarefa Atrasada',
                        message: message,
                        type: 'task_overdue',
                        link: `/staff/tasks/${task.id}`,
                        read: false
                    })

                if (!notifError) notificationsSent++
            }

            // Update or insert notification log
            const { error: logError } = await supabase
                .from('overdue_notifications_log')
                .upsert({
                    tarefa_id: task.id,
                    last_notified_at: now.toISOString()
                })

            if (logError) {
                console.error('Error updating notification log:', logError)
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                overdue_tasks: overdueTasks.length,
                notifications_sent: notificationsSent
            }),
            {
                headers: { 'Content-Type': 'application/json' },
                status: 200
            }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                headers: { 'Content-Type': 'application/json' },
                status: 500
            }
        )
    }
})
