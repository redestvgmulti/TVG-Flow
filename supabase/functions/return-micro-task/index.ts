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

        const { micro_task_id, to_profissional_id, motivo } = await req.json()

        // Validation
        if (!micro_task_id || !to_profissional_id || !motivo || motivo.trim() === '') {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: micro_task_id, to_profissional_id, motivo' }),
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

        // Validate target professional exists
        const { data: targetProfessional, error: profError } = await supabaseClient
            .from('profissionais')
            .select('id, nome')
            .eq('id', to_profissional_id)
            .single()

        if (profError || !targetProfessional) {
            return new Response(
                JSON.stringify({ error: 'Target professional not found' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Update micro task: reassign and mark as devolvida
        const { error: updateError } = await supabaseClient
            .from('tarefas_micro')
            .update({
                status: 'devolvida',
                profissional_id: to_profissional_id
            })
            .eq('id', micro_task_id)

        if (updateError) {
            console.error('Error updating micro task:', updateError)
            return new Response(
                JSON.stringify({ error: 'Failed to return micro task', details: updateError.message }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Log devolution with reason
        await supabaseClient
            .from('tarefas_micro_logs')
            .insert({
                tarefa_micro_id: micro_task_id,
                from_profissional_id: user.id,
                to_profissional_id: to_profissional_id,
                acao: 'returned',
                motivo: motivo.trim()
            })

        // Notify target professional
        await supabaseClient
            .from('notifications')
            .insert({
                profissional_id: to_profissional_id,
                title: 'Etapa Devolvida',
                message: `A etapa ${microTask.funcao} foi devolvida para você: "${microTask.tarefas.titulo}". Motivo: ${motivo}`,
                type: 'micro_task_returned',
                link: `/staff/tasks`,
                read: false
            })

        // Block dependent tasks (handled by trigger, but we log it)
        const { data: dependentTasks } = await supabaseClient
            .from('tarefas_micro')
            .select('id')
            .eq('depends_on', micro_task_id)

        return new Response(
            JSON.stringify({
                success: true,
                micro_task_id,
                reassigned_to: targetProfessional.nome,
                dependent_tasks_blocked: dependentTasks?.length || 0
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
