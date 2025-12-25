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

        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Get user from auth token
        const token = authHeader.replace('Bearer ', '')
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)

        if (authError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { micro_task_id } = await req.json()

        if (!micro_task_id) {
            return new Response(
                JSON.stringify({ error: 'Missing required field: micro_task_id' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Fetch micro task and validate ownership
        const { data: microTask, error: fetchError } = await supabaseClient
            .from('tarefas_micro')
            .select('*, tarefas(titulo)')
            .eq('id', micro_task_id)
            .eq('profissional_id', user.id)
            .single()

        if (fetchError || !microTask) {
            return new Response(
                JSON.stringify({ error: 'Micro task not found or not assigned to you' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Validate status (must be em_execucao to complete)
        if (microTask.status !== 'em_execucao') {
            return new Response(
                JSON.stringify({
                    error: 'Micro task must be in progress to complete',
                    current_status: microTask.status
                }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Update status to concluida
        const { error: updateError } = await supabaseClient
            .from('tarefas_micro')
            .update({ status: 'concluida' })
            .eq('id', micro_task_id)

        if (updateError) {
            console.error('Error updating micro task:', updateError)
            return new Response(
                JSON.stringify({ error: 'Failed to complete micro task', details: updateError.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Log completion
        await supabaseClient
            .from('tarefas_micro_logs')
            .insert({
                tarefa_micro_id: micro_task_id,
                from_profissional_id: user.id,
                acao: 'completed'
            })

        // Find next micro task (if exists)
        const { data: nextMicroTask } = await supabaseClient
            .from('tarefas_micro')
            .select('id, profissional_id, funcao, status')
            .eq('depends_on', micro_task_id)
            .eq('status', 'pendente') // Will be unblocked by trigger
            .single()

        // Notify next professional (if exists)
        if (nextMicroTask) {
            await supabaseClient
                .from('notifications')
                .insert({
                    profissional_id: nextMicroTask.profissional_id,
                    title: 'Etapa Liberada',
                    message: `A etapa ${nextMicroTask.funcao} está pronta para iniciar: "${microTask.tarefas.titulo}"`,
                    type: 'micro_task_unblocked',
                    link: `/staff/tasks`,
                    read: false
                })
        }

        return new Response(
            JSON.stringify({
                success: true,
                micro_task_id,
                next_task_unlocked: !!nextMicroTask
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
