
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
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

        if (profileError || !requesterProfile || !['admin', 'super_admin'].includes(requesterProfile.role)) {
            throw new Error('Unauthorized: Only admins can perform this action')
        }

        const { data: requesterLinks, error: requesterLinksError } = await supabaseAdmin
            .from('empresa_profissionais')
            .select('empresa_id')
            .eq('profissional_id', user.id)
            .eq('ativo', true)

        if (requesterLinksError) throw requesterLinksError

        const requesterCompanyIds = [...new Set((requesterLinks || []).map(link => link.empresa_id))]
        const { data: tenantCompanies, error: tenantCompaniesError } = requesterCompanyIds.length
            ? await supabaseAdmin
                .from('empresas')
                .select('id')
                .in('id', requesterCompanyIds)
                .eq('empresa_tipo', 'tenant')
            : { data: [], error: null }

        if (tenantCompaniesError) throw tenantCompaniesError
        if ((tenantCompanies || []).length !== 1 && requesterProfile.role !== 'super_admin') {
            throw new Error('Não foi possível determinar o tenant ativo do administrador.')
        }

        let tenantId = tenantCompanies[0]?.id

        // 3. Parse Body
        const { email, nome, area_id, role, ativo, tenant_id: requestedTenantId } = await req.json()

        if (!email || !nome) {
            throw new Error('Missing required fields: email, nome')
        }

        // Only a Super Admin may select a tenant explicitly. The Edge Function
        // remains the sole owner of the membership insert for every flow.
        if (requesterProfile.role === 'super_admin' && requestedTenantId) {
            const { data: targetTenant, error: targetTenantError } = await supabaseAdmin
                .from('empresas')
                .select('id')
                .eq('id', requestedTenantId)
                .eq('empresa_tipo', 'tenant')
                .maybeSingle()

            if (targetTenantError) throw targetTenantError
            if (!targetTenant) throw new Error('Invalid target tenant.')
            tenantId = targetTenant.id
        }

        if (!tenantId) throw new Error('Unable to determine the administrator tenant.')

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
                    .upsert({
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

            const { error: linkError } = await supabaseAdmin
                .from('empresa_profissionais')
                .insert({
                    empresa_id: tenantId,
                    profissional_id: userId,
                    funcao: role === 'admin' ? 'Admin' : 'membro',
                    role: role || 'profissional',
                    ativo: true
                })

            if (linkError) throw new Error(`Company link error: ${linkError.message}`)

        } catch (postCreateError) {
            const err = postCreateError as Error
            console.error('Rolling back user creation due to error:', err)
            // ROLLBACK: Delete the auth user if the DB insert failed
            await supabaseAdmin.auth.admin.deleteUser(userId)
            throw err
        }

        return new Response(
            JSON.stringify({
                success: true,
                id: userId,
                tenantId,
                inviteLink: actionLink, // Return the link!
                message: 'Profissional criado com sucesso! Copie o link de convite.'
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            }
        )

    } catch (error) {
        const err = error as Error
        console.error('Edge Function Error:', err)
        return new Response(
            JSON.stringify({ error: err.message, success: false }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400
            }
        )
    }
})
