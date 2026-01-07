import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DeleteRequest {
    os_id: string
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
        const body: DeleteRequest = await req.json()
        const { os_id, motivo } = body

        // Validação básica
        if (!os_id) {
            return new Response(
                JSON.stringify({ error: 'os_id é obrigatório' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Verificar permissão
        const { data: canDelete, error: permError } = await supabaseAdmin
            .rpc('can_delete_os', {
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

        if (!canDelete) {
            return new Response(
                JSON.stringify({
                    error: 'Sem permissão para excluir OS',
                    details: 'Apenas admin ou criador (se pendente sem atividade) podem excluir'
                }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Soft delete: UPDATE deleted_at
        const { error: deleteError } = await supabaseAdmin
            .from('tarefas')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', os_id)

        if (deleteError) {
            console.error('Erro ao excluir OS:', deleteError)
            return new Response(
                JSON.stringify({ error: 'Erro ao excluir OS' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // INSERT evento (com autor_id explícito)
        const { data: eventoData, error: eventoError } = await supabaseAdmin
            .from('os_eventos')
            .insert({
                os_id: os_id,
                tipo: 'os_excluida',
                autor_id: user.id,
                metadata: {
                    motivo: motivo || null,
                    deleted_at: new Date().toISOString()
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
                deleted_at: new Date().toISOString(),
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
