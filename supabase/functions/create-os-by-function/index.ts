import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        const { empresa_id, titulo, descricao, deadline_at, funcoes, prioridade } = await req.json()

        // Validation
        if (!empresa_id || !titulo || !deadline_at || !funcoes || !Array.isArray(funcoes) || funcoes.length === 0) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: empresa_id, titulo, deadline_at, funcoes' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Validate and normalize priority
        const validPriorities = ['baixa', 'normal', 'alta', 'urgente']
        const normalizedPriority = prioridade && validPriorities.includes(prioridade) ? prioridade : 'normal'

        // STEP 1: Resolve professionals for ALL selected functions
        const { data: professionals, error: profError } = await supabaseClient
            .from('empresa_profissionais')
            .select(`
                profissional_id,
                funcao,
                profissionais!inner (
                    id,
                    nome,
                    departamento_id
                )
            `)
            .eq('empresa_id', empresa_id)
            .in('funcao', funcoes)
            .eq('ativo', true)

        if (profError) {
            console.error('Error fetching professionals:', profError)
            return new Response(
                JSON.stringify({ error: 'Erro ao buscar profissionais vinculados', details: profError.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // CRITICAL VALIDATION: Must have at least one professional
        if (!professionals || professionals.length === 0) {
            return new Response(
                JSON.stringify({
                    error: 'Nenhum profissional ativo encontrado para as funções selecionadas nesta empresa.',
                    empresa_id,
                    funcoes
                }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // STEP 2: Create tasks for each professional
        const createdTasks = []
        const notifications = []

        for (const prof of professionals) {
            const professional = prof.profissionais

            if (!professional) continue

            // Create task
            const taskPayload = {
                titulo: `${titulo} - ${prof.funcao}`,
                descricao: descricao || null,
                cliente_id: empresa_id,
                assigned_to: professional.id,
                departamento_id: professional.departamento_id,
                deadline: deadline_at,
                status: 'pendente',
                prioridade: normalizedPriority
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

            // STEP 3: Create in-app notification
            const notificationPayload = {
                profissional_id: professional.id,
                title: 'Nova Tarefa Atribuída',
                message: `Você recebeu uma nova tarefa de ${prof.funcao}: "${titulo}"`,
                type: 'task_assigned',
                link: `/staff/tasks/${task.id}`,
                read: false
            }

            const { error: notifError } = await supabaseClient
                .from('notifications')
                .insert(notificationPayload)

            if (!notifError) {
                notifications.push(professional.id)

                // STEP 4: Send push notification via existing Edge Function
                try {
                    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push-notification`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
                        },
                        body: JSON.stringify({
                            userId: professional.id,
                            title: notificationPayload.title,
                            message: notificationPayload.message
                        })
                    })
                } catch (pushError) {
                    console.error('Error sending push notification:', pushError)
                }
            }
        }

        // Validate that at least one task was created
        if (createdTasks.length === 0) {
            return new Response(
                JSON.stringify({
                    error: 'Nenhuma tarefa foi criada. Verifique se há profissionais vinculados às funções selecionadas.',
                    professionals_found: professionals.length
                }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        return new Response(
            JSON.stringify({
                success: true,
                tasks_created: createdTasks.length,
                notifications_sent: notifications.length,
                tasks: createdTasks.map(t => ({
                    id: t.id,
                    titulo: t.titulo,
                    profissional_id: t.profissional_id
                })),
                professionals: professionals.map(p => ({
                    id: p.profissionais.id,
                    nome: p.profissionais.nome,
                    funcao: p.funcao
                }))
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Unexpected error:', error)
        return new Response(
            JSON.stringify({ error: error.message || 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
