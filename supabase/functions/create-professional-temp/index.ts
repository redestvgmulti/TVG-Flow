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

        const { email, nome } = await req.json()

        // Create auth user (trigger will now insert with nome from metadata)
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.generateLink({
            type: 'invite',
            email,
            options: {
                data: { nome },
                redirectTo: `${Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'}/reset-password`
            }
        })

        if (authError) throw authError

        const userId = authData.user.id
        const inviteLink = authData.properties.action_link

        // Ensure nome is set correctly (trigger may have used email prefix as fallback)
        await supabaseAdmin
            .from('profissionais')
            .update({ nome })
            .eq('id', userId)

        return new Response(
            JSON.stringify({ success: true, userId, inviteLink }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
    } catch (error) {
        const err = error as Error
        return new Response(
            JSON.stringify({ error: err.message, success: false }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
    }
})
