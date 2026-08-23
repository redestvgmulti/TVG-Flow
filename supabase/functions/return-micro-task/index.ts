import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
    // 1. Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            status: 200,
            headers: corsHeaders
        })
    }

    try {
        // 2. Setup Supabase Client
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // 3. Auth Check
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            return new Response(JSON.stringify({ error: 'Missing authorization header' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        const token = authHeader.replace('Bearer ', '')
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)
        if (authError || !user) {
            return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        // 4. Parse Body
        const { micro_task_id, to_profissional_id, motivo } = await req.json()
        if (!micro_task_id || !to_profissional_id || !motivo?.trim()) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const { data: microTask, error: taskError } = await supabaseClient
            .from('tarefas_micro')
            .select('id, profissional_id, status, tarefa_id, tarefas!inner(empresa_id)')
            .eq('id', micro_task_id)
            .single()

        if (taskError || !microTask) {
            return new Response(JSON.stringify({ error: 'Micro task not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const taskCompanyId = microTask.tarefas?.empresa_id
        const { data: callerAccess } = await supabaseClient
            .from('empresa_profissionais')
            .select('empresa_id, profissionais!inner(role, ativo)')
            .eq('empresa_id', taskCompanyId)
            .eq('profissional_id', user.id)
            .eq('ativo', true)
            .eq('profissionais.ativo', true)
            .maybeSingle()

        const callerRole = callerAccess?.profissionais?.role
        const callerCanReturn = microTask.profissional_id === user.id || callerRole === 'admin'
        if (!taskCompanyId || !callerAccess || !callerCanReturn) {
            return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        if (['concluida', 'cancelada'].includes(microTask.status)) {
            return new Response(JSON.stringify({ error: 'Micro task cannot be returned from current status' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        const { data: targetAccess } = await supabaseClient
            .from('empresa_profissionais')
            .select('empresa_id, profissionais!inner(ativo)')
            .eq('empresa_id', taskCompanyId)
            .eq('profissional_id', to_profissional_id)
            .eq('ativo', true)
            .eq('profissionais.ativo', true)
            .maybeSingle()

        if (!targetAccess) {
            return new Response(JSON.stringify({ error: 'Target professional is not active in this tenant' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        // 5. Update Task with a compare-and-set guard.
        const { error: updateError } = await supabaseClient
            .from('tarefas_micro')
            .update({ status: 'devolvida', profissional_id: to_profissional_id })
            .eq('id', micro_task_id)
            .eq('profissional_id', microTask.profissional_id)

        if (updateError) throw updateError

        // 6. Log & Notify
        await supabaseClient.from('tarefas_micro_logs').insert({
            tarefa_micro_id: micro_task_id,
            from_profissional_id: user.id,
            to_profissional_id: to_profissional_id,
            acao: 'returned',
            motivo: motivo.trim()
        })

        await supabaseClient.from('notifications').insert({
            profissional_id: to_profissional_id,
            title: 'Etapa Devolvida',
            message: `Etapa devolvida. Motivo: ${motivo.trim()}`,
            type: 'micro_task_returned',
            link: '/staff/tasks',
            read: false
        })

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
})
