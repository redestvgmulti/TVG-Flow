import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
            { auth: { autoRefreshToken: false, persistSession: false } }
        )
        const { company_id } = await req.json()

        if (!company_id) throw new Error('company_id é obrigatório')

        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error('Não autenticado')

        const token = authHeader.replace('Bearer ', '')
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
        if (userError || !user) throw new Error('Usuário não autenticado')

        const { data, error } = await supabaseAdmin.rpc('deactivate_operational_company', {
            p_actor_id: user.id,
            p_company_id: company_id
        })
        if (error) throw error

        return new Response(
            JSON.stringify({
                success: true,
                status: data?.status,
                message: 'Empresa desativada com sucesso'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
    } catch (error) {
        const err = error as Error
        console.error('Deactivate company error:', err)
        return new Response(
            JSON.stringify({ error: err.message || 'Erro interno no servidor' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
