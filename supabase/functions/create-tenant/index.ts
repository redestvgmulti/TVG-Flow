import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  createAdminClient,
  normalizeEmail,
  normalizeName,
  requireActiveOperator
} from '../_shared/operatorAuth.ts'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (req.method !== 'POST') throw new Error('METHOD_NOT_ALLOWED')

    const supabaseAdmin = createAdminClient()
    await requireActiveOperator(req, supabaseAdmin, ['super_admin'])
    const body = await req.json()
    const companyName = normalizeName(body.companyName)
    const adminName = normalizeName(body.adminName)
    const adminEmail = normalizeEmail(body.adminEmail)
    const cnpj = typeof body.cnpj === 'string' && body.cnpj.trim() ? body.cnpj.trim() : null

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.inviteUserByEmail(adminEmail, {
      data: { nome: adminName },
      redirectTo: `${Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'}/reset-password`
    })

    if (authError || !authData.user?.id) {
      throw new Error(`AUTH_USER_CREATION_FAILED: ${authError?.message ?? 'unknown error'}`)
    }

    const newUserId = authData.user.id
    const { data: tenantId, error: tenantError } = await supabaseAdmin.rpc('create_tenant_db', {
      p_company_name: companyName,
      p_cnpj: cnpj,
      p_admin_id: newUserId,
      p_admin_name: adminName,
      p_admin_email: adminEmail
    })

    if (tenantError) {
      const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(newUserId)
      if (rollbackError) console.error('[create-tenant] Auth rollback failed:', rollbackError.message)
      throw tenantError
    }

    return new Response(JSON.stringify({
      success: true,
      message: 'Tenant criado com sucesso!',
      tenantId,
      userId: newUserId
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    const err = error as Error
    console.error('[create-tenant]', err.message)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: err.message.startsWith('UNAUTHORIZED') ? 401 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
