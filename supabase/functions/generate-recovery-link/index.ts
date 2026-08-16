import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient, normalizeEmail, requireActiveOperator } from '../_shared/operatorAuth.ts'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (req.method !== 'POST') throw new Error('METHOD_NOT_ALLOWED')

    const supabaseAdmin = createAdminClient()
    const operator = await requireActiveOperator(req, supabaseAdmin)
    const { email: rawEmail } = await req.json()
    const email = normalizeEmail(rawEmail)

    const { data: target, error: targetError } = await supabaseAdmin
      .from('profissionais')
      .select('id, role, ativo')
      .ilike('email', email)
      .maybeSingle()

    if (targetError) throw targetError
    if (!target || target.ativo !== true) throw new Error('ACTIVE_TARGET_NOT_FOUND')
    if (target.role === 'super_admin') throw new Error('SUPER_ADMIN_PROTECTED')

    if (operator.role === 'admin') {
      if (target.role !== 'staff') {
        throw new Error('ROLE_SCOPE_FORBIDDEN: Tenant admins may reset staff access only.')
      }

      const { data: targetTenantLinks, error: tenantError } = await supabaseAdmin
        .from('empresa_profissionais')
        .select('empresa_id, empresas!inner(id, empresa_tipo, ativo)')
        .eq('profissional_id', target.id)
        .eq('ativo', true)
        .eq('empresas.empresa_tipo', 'tenant')
        .eq('empresas.ativo', true)

      if (tenantError) throw tenantError
      const targetTenantIds = [...new Set((targetTenantLinks ?? []).map((link: { empresa_id: string }) => link.empresa_id))]
      if (targetTenantIds.length !== 1 || targetTenantIds[0] !== operator.tenantIds[0]) {
        throw new Error('TENANT_SCOPE_FORBIDDEN')
      }
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: `${Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'}/reset-password`
      }
    })

    if (authError) throw authError
    if (authData.user.id !== target.id) throw new Error('AUTH_PROFILE_MISMATCH')

    return new Response(JSON.stringify({
      success: true,
      recoveryLink: authData.properties.action_link,
      message: 'Link de recuperação gerado com sucesso.'
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    const err = error as Error
    console.error('[generate-recovery-link]', err.message)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: err.message.startsWith('UNAUTHORIZED') ? 401 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
