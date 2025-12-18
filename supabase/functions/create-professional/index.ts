
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
        // Service Role for privileged operations (Creating User, Inserting to protected table)
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
            { auth: { autoRefreshToken: false, persistSession: false } }
        )

        // Client for verifying the caller (using the Authorization header from request)
        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            throw new Error('Missing Authorization header')
        }

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        )

        // 2. Security Check: Verify if caller is authenticated and is an ADMIN
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
        if (userError || !user) {
            throw new Error('Unauthorized: Invalid token')
        }

        // Check role in 'profissionais' table
        const { data: requesterProfile, error: profileError } = await supabaseAdmin
            .from('profissionais')
            .select('role')
            .eq('id', user.id)
            .single()

        if (profileError || !requesterProfile || requesterProfile.role !== 'admin') {
            throw new Error('Unauthorized: Only admins can perform this action')
        }

        // 3. Parse and Validate Body
        const { email, password, name, area_id, role, ativo } = await req.json()

        if (!email || !password || !name) {
            throw new Error('Missing required fields: email, password, name')
        }

        // 4. Create User in Supabase Auth
        // We use admin.createUser to skip email verification if needed (email_confirm: true)
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { nome: name }
        })

        if (authError) {
            // Return specific message for duplicates
            if (authError.message.includes('already been registered')) {
                throw new Error('Este e-mail já está cadastrado no sistema.')
            }
            throw authError
        }

        const userId = authData.user.id

        // 5. Insert into 'profissionais' table
        const { error: dbError } = await supabaseAdmin
            .from('profissionais')
            .insert({
                id: userId,
                nome: name,
                email: email,
                area_id: area_id || null, // Allow null if not assigned yet
                role: role || 'profissional',
                ativo: ativo !== undefined ? ativo : true,
                created_at: new Date().toISOString()
            })

        if (dbError) {
            // Compensating Transaction: Delete the Auth user if DB insert fails
            // This prevents "Zombie Users" in Auth that don't satisfy the system's structural requirements
            console.error('Database insert failed, rolling back Auth creation...', dbError)
            await supabaseAdmin.auth.admin.deleteUser(userId)
            throw new Error(`Database Error: ${dbError.message}`)
        }

        // 6. Success Response
        return new Response(
            JSON.stringify({ success: true, id: userId, message: 'Profissional cadastrado com sucesso' }),
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
                status: 400 // Bad Request for business logic errors
            }
        )
    }
})
