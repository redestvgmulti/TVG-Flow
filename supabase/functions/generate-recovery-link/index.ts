
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
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

        const authHeader = req.headers.get('Authorization')
        if (!authHeader) throw new Error('Missing Authorization header')

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        )

        // 1. Security Check: Admin Only
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
        if (userError || !user) throw new Error('Unauthorized: Invalid token')

        const { data: requesterProfile, error: profileError } = await supabaseAdmin
            .from('profissionais')
            .select('role')
            .eq('id', user.id)
            .single()

        if (profileError || !requesterProfile || requesterProfile.role !== 'admin') {
            throw new Error('Unauthorized: Only admins can perform this action')
        }

        // 2. Parse Body
        const { email } = await req.json()

        if (!email) {
            throw new Error('Missing required field: email')
        }

        // 3. Generate Recovery Link (Auth)
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.generateLink({
            type: 'recovery',
            email: email,
            options: {
                redirectTo: `${Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'}/reset-password`
            }
        })

        if (authError) {
            throw authError
        }

        const actionLink = authData.properties.action_link

        return new Response(
            JSON.stringify({
                success: true,
                recoveryLink: actionLink,
                message: 'Link de recuperação gerado com sucesso.'
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            }
        )

    } catch (error) {
        console.error('Edge Function Error:', error)
        return new Response(
            JSON.stringify({ error: error.message, success: false }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400
            }
        )
    }
})
