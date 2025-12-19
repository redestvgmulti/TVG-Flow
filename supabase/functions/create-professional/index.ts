
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

        // 3. Parse Body (NO PASSWORD)
        const { email, name, area_id, role, ativo } = await req.json()

        if (!email || !name) {
            throw new Error('Missing required fields: email, name')
        }

        // 4. Create User (Auth) - SEM SENHA, email_confirm: false
        // Correcão C: email_confirm: false é intencional. O link de recovery validará o email.
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            email_confirm: false,
            user_metadata: { nome: name }
        })

        if (authError) {
            if (authError.message.includes('already been registered')) {
                throw new Error('Este e-mail já está cadastrado no sistema.')
            }
            throw authError
        }

        const userId = authData.user.id

        // 5. Transaction Block (DB Insert + Email) - CORREÇÃO A: ROLLBACK TOTAL
        try {
            // A. Insert into 'profissionais'
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

            // B. Send Recovery Email (Simulating Invite)
            // Usamos resetPasswordForEmail para o Supabase enviar o email (Beta/Default SMTP)
            // Redireciona para /reset-password
            const { error: emailError } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
                redirectTo: `${Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'}/reset-password`
            })

            if (emailError) throw new Error(`Email Error: ${emailError.message}`)

        } catch (postCreateError) {
            console.error('Rolling back user creation due to error:', postCreateError)
            // ROLLBACK TOTAL: Deletes the auth user to prevent zombies
            await supabaseAdmin.auth.admin.deleteUser(userId)
            throw postCreateError
        }

        return new Response(
            JSON.stringify({
                success: true,
                id: userId,
                message: 'Profissional convidado com sucesso! Email de definição de senha enviado.'
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
