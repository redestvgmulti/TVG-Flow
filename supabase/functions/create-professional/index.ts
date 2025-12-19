
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
        const { email, name, area_id, role, ativo } = await req.json()

        if (!email || !name) {
            throw new Error('Missing required fields: email, name')
        }

        // 4. Invite User (Auth)
        // This automatically sends the "Invite User" email template
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
            data: { nome: name }, // Metadata
            redirectTo: `${Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'}/reset-password`
        })

        if (authError) {
            if (authError.message.includes('already been registered')) {
                throw new Error('Este e-mail já está cadastrado no sistema (Auth).')
            }
            throw authError
        }

        const userId = authData.user.id

        // 5. Transaction Block (DB Insert)
        try {
            // Check if profile exists (handling edge case of pre-existing auth user but no profile)
            const { data: existingProfile } = await supabaseAdmin
                .from('profissionais')
                .select('id')
                .eq('email', email)
                .single()

            if (existingProfile) {
                // Return success if already exists to avoid error, but update data?
                // For now, let's just proceed to update ensuring consistency
                const { error: updateError } = await supabaseAdmin
                    .from('profissionais')
                    .update({
                        nome: name,
                        area_id: area_id || null,
                        role: role || 'profissional',
                        ativo: ativo !== undefined ? ativo : true
                    })
                    .eq('id', existingProfile.id)

                if (updateError) throw updateError
            } else {
                // Insert into 'profissionais'
                const { error: dbError } = await supabaseAdmin
                    .from('profissionais')
                    .insert({
                        id: userId,
                        nome: name,
                        email: email,
                        area_id: area_id || null,
                        role: role || 'profissional',
                        ativo: ativo !== undefined ? ativo : true,
                        created_at: new Date().toISOString()
                    })

                if (dbError) throw new Error(`Database Error: ${dbError.message}`)
            }

        } catch (postCreateError) {
            console.error('Rolling back user invitation due to error:', postCreateError)
            // ROLLBACK: Delete the auth user if the DB insert failed
            // Note: This effectively "cancels" the invite on the Auth side so they can't login without a profile
            await supabaseAdmin.auth.admin.deleteUser(userId)
            throw postCreateError
        }

        return new Response(
            JSON.stringify({
                success: true,
                id: userId,
                message: 'Convite enviado com sucesso! O usuário receberá um email para definir a senha.'
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
