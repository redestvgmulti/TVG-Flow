import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AlterarPrazoRequest {
    os_id: string
    novo_prazo: string // ISO date string
    motivo?: string
}

serve(async (req) => {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Create Supabase client with service_role
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
        const body: AlterarPrazoRequest = await req.json()
        const { os_id, novo_prazo, motivo } = body

        // Validações básicas
        if (!os_id) {
            return new Response(
                JSON.stringify({ error: 'os_id é obrigatório' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (!novo_prazo) {
            return new Response(
                JSON.stringify({ error: 'novo_prazo é obrigatório' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Validar formato de data
        const prazoDate = new Date(novo_prazo)
        if (isNaN(prazoDate.getTime())) {
            return new Response(
                JSON.stringify({ error: 'novo_prazo deve ser uma data válida (ISO 8601)' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Verificar permissão
        const { data: canChange, error: permError } = await supabaseAdmin
            .rpc('can_change_deadline', {
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

        if (!canChange) {
            return new Response(
                JSON.stringify({
                    error: 'Sem permissão para alterar prazo',
                    details: 'Apenas admin ou criador (se pendente) podem alterar prazo'
                }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Buscar prazo atual
        const { data: osData, error: osError } = await supabaseAdmin
            .from('tarefas')
            .select('id, deadline')
            .eq('id', os_id)
            .single()

        if (osError || !osData) {
            return new Response(
                JSON.stringify({ error: 'OS não encontrada' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const prazo_anterior = osData.deadline

        // UPDATE deadline
        const { error: updateError } = await supabaseAdmin
            .from('tarefas')
            .update({ deadline: novo_prazo })
            .eq('id', os_id)

        if (updateError) {
            console.error('Erro ao atualizar prazo:', updateError)
            return new Response(
                JSON.stringify({ error: 'Erro ao atualizar prazo' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // INSERT evento (com autor_id explícito)
        const { data: eventoData, error: eventoError } = await supabaseAdmin
            .from('os_eventos')
            .insert({
                os_id: os_id,
                tipo: 'prazo_alterado',
                autor_id: user.id,
                metadata: {
                    de: prazo_anterior,
                    para: novo_prazo,
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
                prazo_anterior: prazo_anterior,
                prazo_novo: novo_prazo,
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
