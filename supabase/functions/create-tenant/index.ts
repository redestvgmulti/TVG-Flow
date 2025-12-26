
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

        // 2. Auth Check: Ensure caller is logged in
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
        if (userError || !user) throw new Error('Unauthorized: Invalid token')

        // 3. Parse Body
        const { companyName, cnpj, adminName, adminEmail } = await req.json()

        if (!companyName || !adminName || !adminEmail) {
            throw new Error('Missing required fields: companyName, adminName, adminEmail')
        }

        // 4. Create Auth User (Invite)
        // We use inviteUserByEmail to create the user in Auth and send/generate an invite.
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(adminEmail, {
            data: { nome: adminName }, // Store name in metadata
            redirectTo: `${Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'}/reset-password`
        })

        if (authError) {
            // Handle "User already registered" gracefully if needed, or just throw
            throw new Error(`Erro ao criar usuário Auth: ${authError.message}`)
        }

        const newUserId = authData.user.id

        // 5. Create Tenant in DB
        try {
            const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('create_tenant_db', {
                p_company_name: companyName,
                p_cnpj: cnpj,
                p_admin_id: newUserId,
                p_admin_name: adminName,
                p_admin_email: adminEmail
            })

            if (rpcError) throw rpcError

        } catch (dbError) {
            console.error('Rolling back auth user due to DB error:', dbError)
            // Rollback: Delete the just-created auth user
            await supabaseAdmin.auth.admin.deleteUser(newUserId)
            throw new Error(`Erro ao criar tenant na base de dados: ${dbError.message}`)
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: 'Tenant criado com sucesso!',
                userId: newUserId
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            }
        )

    } catch (error) {
        console.error('Edge Function Error:', error)
        return new Response(
            JSON.stringify({
                success: false,
                error: error.message,
                stack: error.stack,
                envCheck: {
                    hasUrl: !!Deno.env.get('SUPABASE_URL'),
                    hasServiceRole: !!Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
                }
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200 // Return 200 so we can read the body in frontend easily
            }
        )
    }
})
