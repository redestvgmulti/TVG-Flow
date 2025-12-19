
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // 1. Setup Clients
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

        // 2. Security Check: Admin Only
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

        // 3. Parse Body
        const { email, nome, area_id, role, ativo } = await req.json()

        if (!email || !nome) {
            throw new Error('Missing required fields: email, nome')
        }

        // 4. Generate Invite Link (Auth)
        // Instead of sending email, we generate the link to return to the admin
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.generateLink({
            type: 'invite',
            email: email,
            options: {
                data: { nome: nome }, // Metadata
                redirectTo: `${Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'}/reset-password`
            }
        })

        if (authError) {
            if (authError.message.includes('already been registered')) {
                throw new Error('Este e-mail já está cadastrado no sistema (Auth).')
            }
            throw authError
        }

        const userId = authData.user.id
        const actionLink = authData.properties.action_link

        // 5. Transaction Block (DB Insert)
        try {
            // Check if profile exists
            const { data: existingProfile } = await supabaseAdmin
                .from('profissionais')
                .select('id')
                .eq('email', email)
                .single()

            if (existingProfile) {
                const { error: updateError } = await supabaseAdmin
                    .from('profissionais')
                    .update({
                        nome: nome,
                        area_id: area_id || null,
                        role: role || 'profissional',
                        ativo: ativo !== undefined ? ativo : true
                    })
                    .eq('id', existingProfile.id)

                if (updateError) throw updateError
            } else {
                const { error: dbError } = await supabaseAdmin
                    .from('profissionais')
                    .insert({
                        id: userId,
                        nome: nome,
                        email: email,
                        area_id: area_id || null,
                        role: role || 'profissional',
                        ativo: ativo !== undefined ? ativo : true,
                        created_at: new Date().toISOString()
                    })

                if (dbError) throw new Error(`Database Error: ${dbError.message}`)
            }

        } catch (postCreateError) {
            console.error('Rolling back user creation due to error:', postCreateError)
            // ROLLBACK: Delete the auth user if the DB insert failed
            await supabaseAdmin.auth.admin.deleteUser(userId)
            throw postCreateError
        }

        return new Response(
            JSON.stringify({
                success: true,
                id: userId,
                inviteLink: actionLink, // Return the link!
                message: 'Profissional criado com sucesso! Copie o link de convite.'
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
