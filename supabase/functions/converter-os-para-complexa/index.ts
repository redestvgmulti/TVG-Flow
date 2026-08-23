import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ConvertRequest {
    os_id: string
    micro_tasks: {
        profissional_id: string
        descricao: string
        ordem: number
    }[]
    motivo?: string
}

serve(async (req) => {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Create Supabase client with service_role (bypass RLS)
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        )

        // Get user from auth header
        const authHeader = req.headers.get('Authorization')!
        const token = authHeader.replace('Bearer ', '')
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)

        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Não autenticado' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Parse request body
        const body: ConvertRequest = await req.json()
        const { os_id, micro_tasks, motivo } = body

        // Validações básicas
        if (!os_id) {
            return new Response(
                JSON.stringify({ error: 'os_id é obrigatório' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (!micro_tasks || micro_tasks.length === 0) {
            return new Response(
                JSON.stringify({ error: 'Deve fornecer ao menos 1 micro-task' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Verificar permissão usando função SQL
        const { data: canConvert, error: permError } = await supabaseAdmin
            .rpc('can_convert_to_complex', {
                p_os_id: os_id,
                p_user_id: user.id
            })

        if (permError) {
            console.error('Erro ao verificar permissão:', permError)
            return new Response(
                JSON.stringify({ error: 'Erro ao verificar permissão' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (!canConvert) {
            return new Response(
                JSON.stringify({
                    error: 'Sem permissão para converter OS',
                    details: 'Apenas admin pode converter OS simples em complexa'
                }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Buscar staff original (assigned_to)
        const { data: osData, error: osError } = await supabaseAdmin
            .from('tarefas')
            .select('id, assigned_to, empresa_id')
            .eq('id', os_id)
            .single()

        if (osError || !osData) {
            return new Response(
                JSON.stringify({ error: 'OS não encontrada' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const targetProfessionalIds = [...new Set(micro_tasks.map(mt => mt.profissional_id))]
        const { data: targetMemberships, error: targetMembershipError } = await supabaseAdmin
            .from('empresa_profissionais')
            .select('profissional_id')
            .eq('empresa_id', osData.empresa_id)
            .eq('ativo', true)
            .in('profissional_id', targetProfessionalIds)

        if (
            targetMembershipError ||
            (targetMemberships?.length ?? 0) !== targetProfessionalIds.length
        ) {
            return new Response(
                JSON.stringify({ error: 'Todos os profissionais devem ter vínculo ativo com o tenant da OS' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // BEGIN TRANSACTION (via Edge Function é sequencial)

        // 1. UPDATE tarefas: marcar como complexa
        const { error: updateError } = await supabaseAdmin
            .from('tarefas')
            .update({ has_micro_tasks: true })
            .eq('id', os_id)

        if (updateError) {
            console.error('Erro ao atualizar tarefas:', updateError)
            return new Response(
                JSON.stringify({ error: 'Erro ao converter OS' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 2. INSERT micro-tasks
        const microTasksToInsert = micro_tasks.map((mt, index) => ({
            tarefa_id: os_id,
            profissional_id: mt.profissional_id,
            descricao: mt.descricao,
            ordem: mt.ordem || index + 1,
            status: 'pendente'
        }))

        const { data: insertedMicroTasks, error: insertError } = await supabaseAdmin
            .from('tarefas_micro')
            .insert(microTasksToInsert)
            .select('id')

        if (insertError) {
            console.error('Erro ao criar micro-tasks:', insertError)
            // Rollback: reverter has_micro_tasks
            await supabaseAdmin
                .from('tarefas')
                .update({ has_micro_tasks: false })
                .eq('id', os_id)

            return new Response(
                JSON.stringify({ error: 'Erro ao criar micro-tasks' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 3. INSERT evento (com autor_id explícito)
        const { data: eventoData, error: eventoError } = await supabaseAdmin
            .from('os_eventos')
            .insert({
                os_id: os_id,
                tipo: 'os_convertida_complexa',
                autor_id: user.id, // Autor explícito
                metadata: {
                    etapas_criadas: micro_tasks.length,
                    staff_original: osData.assigned_to,
                    motivo: motivo || null
                }
            })
            .select('id')
            .single()

        if (eventoError) {
            console.error('Erro ao criar evento:', eventoError)
            // Não faz rollback - evento é secundário
        }

        // Sucesso!
        return new Response(
            JSON.stringify({
                success: true,
                os_id: os_id,
                micro_tasks_criadas: insertedMicroTasks?.length || micro_tasks.length,
                evento_id: eventoData?.id
            }),
            {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        )

    } catch (error) {
        console.error('Erro inesperado:', error)
        return new Response(
            JSON.stringify({
                error: 'Erro interno do servidor',
                details: error.message
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
