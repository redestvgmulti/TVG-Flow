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
        const { professional_id } = await req.json()

        if (!professional_id) throw new Error('professional_id é obrigatório')

        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error('Não autenticado')

        const token = authHeader.replace('Bearer ', '')
        const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
        if (userError || !user) throw new Error('Usuário não autenticado')

        // The RPC validates role and tenant scope in one database transaction,
        // then deactivates the account and removes its operational memberships.
        const { data: result, error: deactivateError } = await supabaseAdmin
            .rpc('deactivate_professional', {
                p_actor_id: user.id,
                p_professional_id: professional_id
            })

        if (deactivateError) throw deactivateError

        // Database access is already removed above. These calls additionally
        // revoke sessions and block future Auth sign-ins.
        const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(
            professional_id,
            'global'
        )
        const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
            professional_id,
            { ban_duration: '876000h' }
        )

        if (signOutError || banError) {
            console.error('Auth revocation error:', signOutError || banError)
        }

        return new Response(
            JSON.stringify({
                success: true,
                status: result?.status,
                auth_revocation_pending: Boolean(signOutError || banError),
                message: signOutError || banError
                    ? 'Profissional desativado com sucesso. O acesso operacional já foi removido, mas não foi possível confirmar a revogação de sessão agora.'
                    : 'Profissional desativado e acesso revogado com sucesso'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
    } catch (error) {
        const err = error as Error
        console.error('Edge Function Error:', err)
        return new Response(
            JSON.stringify({ error: err.message || 'Erro interno no servidor' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
