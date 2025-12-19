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

        const { professional_id, payload } = await req.json()

        // Validar dados
        if (!professional_id) {
            throw new Error('professional_id é obrigatório')
        }
        if (!payload) {
            throw new Error('Payload de atualização é obrigatório')
        }

        // Obter o ID do usuário que está fazendo a requisição
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            throw new Error('Não autenticado')
        }

        const token = authHeader.replace('Bearer ', '')
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)

        if (userError || !user) {
            throw new Error('Usuário não autenticado')
        }

        // Verificar se o usuário atual é admin
        const { data: currentUser, error: currentUserError } = await supabaseAdmin
            .from('profissionais')
            .select('role')
            .eq('id', user.id)
            .single()

        if (currentUserError || !currentUser) {
            throw new Error('Usuário solicitante não encontrado')
        }

        if (currentUser.role !== 'admin') {
            throw new Error('Apenas administradores podem atualizar profissionais')
        }

        // Executar atualização usando service_role para bypassar RLS
        const { data, error: updateError } = await supabaseAdmin
            .from('profissionais')
            .update(payload)
            .eq('id', professional_id)
            .select()

        if (updateError) throw updateError

        return new Response(
            JSON.stringify({ success: true, data }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )

    } catch (error) {
        console.error('Edge Function Error:', error)
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
