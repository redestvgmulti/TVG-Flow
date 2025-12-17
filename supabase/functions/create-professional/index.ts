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

        const { nome, email, role, ativo, area_id } = await req.json()

        // Validar dados
        if (!nome || !email || !role) {
            throw new Error('Nome, email e role são obrigatórios')
        }

        // 1. Criar usuário no Auth
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: { nome }
        })

        if (authError) throw authError

        // 2. Inserir profissional
        const { error: insertError } = await supabaseAdmin
            .from('profissionais')
            .insert([{
                id: authData.user.id,
                nome,
                email,
                role,
                ativo: ativo ?? true,
                area_id: area_id || null
            }])

        if (insertError) {
            // Se falhar, deletar usuário Auth criado
            await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
            throw insertError
        }

        return new Response(
            JSON.stringify({ success: true, user_id: authData.user.id }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
