import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.6'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // Parse payload
        const { empresa_id, titulo, descricao, deadline_at, funcoes } = await req.json()

        // Validation
        if (!empresa_id || !titulo || !deadline_at || !funcoes || !Array.isArray(funcoes) || funcoes.length === 0) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: empresa_id, titulo, deadline_at, funcoes' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const createdTasks = []
        const notificationsSent = []

        // For each selected function, find professionals and create tasks
        for (const funcao of funcoes) {
            // 1. Find active professionals for this company and function
            // We also fetch the professional's department (linked via profissionais table)
            // Note: Assuming 'empresa_profissionais' has 'profissional_id' and 'profissionais' has 'departamento_id'
            const { data: links, error: linkError } = await supabaseClient
                .from('empresa_profissionais')
                .select(`
          profissional_id,
          profissionais!inner (
            id,
            departamento_id,
            nome
          )
        `)
                .eq('empresa_id', empresa_id)
                .eq('funcao', funcao)
                .eq('ativo', true)

            if (linkError) {
                console.error(`Error fetching professionals for function ${funcao}:`, linkError)
                continue // Skip this function if error, or throw? better to convert partial?
            }

            if (!links || links.length === 0) {
                console.log(`No professionals found for function: ${funcao} in company: ${empresa_id}`)
                continue
            }

            // 2. Create Task for each professional
            for (const link of links) {
                const professional = link.profissionais

                if (!professional) continue

                // Create Task
                const taskPayload = {
                    titulo: `${titulo} - ${funcao}`,
                    descricao: descricao,
                    cliente_id: empresa_id,
                    profissional_id: professional.id,
                    departamento_id: professional.departamento_id, // Important for RLS and categorization
                    prioridade: 'media', // Default priority
                    deadline: deadline_at,
                    status: 'pendente'
                }

                const { data: task, error: taskError } = await supabaseClient
                    .from('tarefas')
                    .insert(taskPayload)
                    .select()
                    .single()

                if (taskError) {
                    console.error(`Error creating task for ${professional.nome}:`, taskError)
                    continue
                }

                createdTasks.push(task)

                // 3. Create Notification (In-App)
                const notificationPayload = {
                    profissional_id: professional.id,
                    title: 'Nova Tarefa Atribuída',
                    message: `Você recebeu uma nova tarefa de ${funcao}: "${titulo}"`,
                    type: 'task_assigned',
                    link: `/staff/tasks/${task.id}`,
                    read: false,
                    created_at: new Date().toISOString()
                }

                const { data: notif, error: notifError } = await supabaseClient
                    .from('notifications')
                    .insert(notificationPayload)
                    .select()
                    .single()

                if (notifError) {
                    console.error('Error creating in-app notification:', notifError)
                } else {
                    // 4. Send Push Notification (if in-app creation worked, likely user exists)
                    await sendPushNotification(supabaseClient, professional.id, notificationPayload.title, notificationPayload.message)
                    notificationsSent.push(professional.id)
                }
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                itemsCreated: createdTasks.length,
                tasks: createdTasks,
                notifications: notificationsSent.length
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Unexpected error:', error)
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})

// Helper to send Push Notification
async function sendPushNotification(supabase: any, userId: string, title: string, message: string) {
    try {
        // VAPID keys
        const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
        const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')

        if (!vapidPublicKey || !vapidPrivateKey) {
            console.warn('VAPID keys not configured, skipping push.')
            return
        }

        webpush.setVapidDetails(
            'mailto:contato@tvgflow.com',
            vapidPublicKey,
            vapidPrivateKey
        )

        // Fetch user's push subscriptions
        const { data: subscriptions, error: subError } = await supabase
            .from('push_subscriptions')
            .select('*')
            .eq('profissional_id', userId)

        if (subError || !subscriptions || subscriptions.length === 0) {
            return
        }

        const payload = JSON.stringify({
            title,
            message,
            icon: '/icon-192x192.png',
            badge: '/badge-72x72.png',
            timestamp: Date.now(),
        })

        // Send to all subscriptions
        const promises = subscriptions.map(async (sub: any) => {
            try {
                await webpush.sendNotification({
                    endpoint: sub.endpoint,
                    keys: { p256dh: sub.p256dh_key, auth: sub.auth_key }
                }, payload)
            } catch (e: any) {
                if (e.statusCode === 410 || e.statusCode === 404) {
                    // Cleanup invalid subscription
                    await supabase.from('push_subscriptions').delete().eq('id', sub.id)
                }
            }
        })

        await Promise.all(promises)

    } catch (e) {
        console.error('Error sending push:', e)
    }
}
