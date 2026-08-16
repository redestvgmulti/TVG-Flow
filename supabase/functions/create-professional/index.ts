import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  createAdminClient,
  normalizeEmail,
  normalizeName,
  normalizeRequestedRole,
  requireActiveOperator
} from '../_shared/operatorAuth.ts'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (req.method !== 'POST') throw new Error('METHOD_NOT_ALLOWED')

    const supabaseAdmin = createAdminClient()
    const operator = await requireActiveOperator(req, supabaseAdmin)
    const body = await req.json()
    const email = normalizeEmail(body.email)
    const nome = normalizeName(body.nome)
    const role = normalizeRequestedRole(body.role)

    if (operator.role === 'admin' && role !== 'staff') {
      throw new Error('ROLE_SCOPE_FORBIDDEN: Tenant admins may create staff only.')
    }

    let tenantId: string
    if (operator.role === 'super_admin') {
      if (typeof body.tenant_id !== 'string' || !body.tenant_id) {
        throw new Error('TENANT_REQUIRED: A super administrator must select the target tenant.')
      }
      tenantId = body.tenant_id
    } else {
      tenantId = operator.tenantIds[0]
      if (body.tenant_id && body.tenant_id !== tenantId) {
        throw new Error('TENANT_SCOPE_FORBIDDEN')
      }
    }

    const { data: targetTenant, error: tenantError } = await supabaseAdmin
      .from('empresas')
      .select('id')
      .eq('id', tenantId)
      .eq('empresa_tipo', 'tenant')
      .eq('ativo', true)
      .maybeSingle()

    if (tenantError) throw tenantError
    if (!targetTenant) throw new Error('INVALID_TARGET_TENANT')

    const redirectTo = `${Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'}/reset-password`
    const inviteResult = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { data: { nome }, redirectTo }
    })

    let authData = inviteResult.data
    let reusedExistingAccount = false

    if (inviteResult.error) {
      if (!inviteResult.error.message.toLowerCase().includes('already')) throw inviteResult.error

      const recoveryResult = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo }
      })

      if (recoveryResult.error) throw recoveryResult.error
      authData = recoveryResult.data
      reusedExistingAccount = true
    }

    if (!authData?.user?.id || !authData.properties?.action_link) {
      throw new Error('AUTH_LINK_GENERATION_FAILED')
    }

    const userId = authData.user.id

    // Unban an existing Auth account before the DB transaction. If the DB
    // transaction fails, its inactive profile still denies application access.
    if (reusedExistingAccount) {
      const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        ban_duration: 'none',
        user_metadata: { ...authData.user.user_metadata, nome }
      })
      if (authUpdateError) throw authUpdateError
    }

    const { data: provisioned, error: provisionError } = await supabaseAdmin.rpc(
      'provision_professional_identity',
      {
        p_actor_id: operator.id,
        p_user_id: userId,
        p_email: email,
        p_name: nome,
        p_area_id: body.area_id || null,
        p_role: role,
        p_tenant_id: tenantId
      }
    )

    if (provisionError) {
      if (!reusedExistingAccount) {
        const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(userId)
        if (rollbackError) console.error('[create-professional] Auth rollback failed:', rollbackError.message)
      }
      throw provisionError
    }

    return new Response(JSON.stringify({
      success: true,
      id: userId,
      tenantId,
      role: provisioned?.role ?? role,
      reusedExistingAccount,
      inviteLink: authData.properties.action_link,
      message: reusedExistingAccount
        ? 'Profissional reativado com sucesso! Copie o link de acesso.'
        : 'Profissional criado com sucesso! Copie o link de convite.'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    const err = error as Error
    console.error('[create-professional]', err.message)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: err.message.startsWith('UNAUTHORIZED') ? 401 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
