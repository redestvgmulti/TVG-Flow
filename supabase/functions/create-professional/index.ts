
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

        // 4. Generate an invite for a new account or a recovery link for an
        // existing account. Retrying a deactivated professional must provision
        // the account instead of failing on the duplicate email.
        const inviteResult = await supabaseAdmin.auth.admin.generateLink({
            type: 'invite',
            email: email,
            options: {
                data: { nome: nome }, // Metadata
                redirectTo: `${Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'}/reset-password`
            }
        })

        let authData = inviteResult.data
        let reusedExistingAccount = false

        if (inviteResult.error) {
            if (!inviteResult.error.message.includes('already been registered')) throw inviteResult.error

            const recoveryResult = await supabaseAdmin.auth.admin.generateLink({
                type: 'recovery',
                email,
                options: {
                    redirectTo: `${Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'}/reset-password`
                }
            })

            if (recoveryResult.error) throw recoveryResult.error
            authData = recoveryResult.data
            reusedExistingAccount = true
        }

        if (!authData?.user) throw new Error('Unable to generate an access link.')
        const userId = authData.user.id
        const actionLink = authData.properties.action_link

        // 5. Transaction Block (DB Insert)
        try {
            // Check if profile exists
            const { data: existingProfile } = await supabaseAdmin
                .from('profissionais')
                .select('id')
                .eq('email', email)
                .maybeSingle()

            if (existingProfile) {
                if (existingProfile.id !== userId) {
                    throw new Error('Profile and Auth account do not match.')
                }

                const { error: updateError } = await supabaseAdmin
                    .from('profissionais')
                    .update({
                        nome: nome,
                        area_id: area_id || null,
                        ativo: true
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

            const { data: existingLink, error: existingLinkError } = await supabaseAdmin
                .from('empresa_profissionais')
                .select('id')
                .eq('empresa_id', tenantId)
                .eq('profissional_id', userId)
                .maybeSingle()

            if (existingLinkError) throw existingLinkError

            const linkError = existingLink
                ? (await supabaseAdmin
                    .from('empresa_profissionais')
                    .update({ ativo: true })
                    .eq('id', existingLink.id)).error
                : (await supabaseAdmin
                    .from('empresa_profissionais')
                    .insert({
                        empresa_id: tenantId,
                        profissional_id: userId,
                        funcao: role === 'admin' ? 'Admin' : 'membro',
                        role: role || 'profissional',
                        ativo: true
                    })).error

            if (linkError) throw new Error(`Company link error: ${linkError.message}`)

        } catch (postCreateError) {
            const err = postCreateError as Error
            console.error('Rolling back user creation due to error:', err)
            // Never delete a pre-existing Auth account during a failed retry.
            if (!reusedExistingAccount) await supabaseAdmin.auth.admin.deleteUser(userId)
            throw err
        }

        return new Response(
            JSON.stringify({
                success: true,
                id: userId,
                tenantId,
                reusedExistingAccount,
                inviteLink: actionLink, // Return the link!
                message: reusedExistingAccount
                    ? 'Profissional reativado com sucesso! Copie o link de acesso.'
                    : 'Profissional criado com sucesso! Copie o link de convite.'
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
