import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient, requireActiveOperator } from '../_shared/operatorAuth.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (req.method !== 'POST') throw new Error('METHOD_NOT_ALLOWED')

    const supabaseAdmin = createAdminClient()
    await requireActiveOperator(req, supabaseAdmin, ['super_admin'])
    const { professional_id, tenant_empresa_id } = await req.json()

    if (typeof professional_id !== 'string' || !professional_id) {
      throw new Error('PROFESSIONAL_ID_REQUIRED')
    }
    if (typeof tenant_empresa_id !== 'string' || !tenant_empresa_id) {
      throw new Error('TENANT_ID_REQUIRED: Automatic tenant selection is forbidden.')
    }

    const [{ data: professional, error: professionalError }, { data: tenant, error: tenantError }] = await Promise.all([
      supabaseAdmin
        .from('profissionais')
        .select('id, email, role, ativo')
        .eq('id', professional_id)
        .maybeSingle(),
      supabaseAdmin
        .from('empresas')
        .select('id, nome')
        .eq('id', tenant_empresa_id)
        .eq('empresa_tipo', 'tenant')
        .eq('ativo', true)
        .maybeSingle()
    ])

    if (professionalError) throw professionalError
    if (tenantError) throw tenantError
    if (!professional || professional.ativo !== true || professional.role !== 'admin') {
      throw new Error('ACTIVE_ADMIN_NOT_FOUND')
    }
    if (!tenant) throw new Error('ACTIVE_TENANT_NOT_FOUND')

    const { data: currentLinks, error: linksError } = await supabaseAdmin
      .from('empresa_profissionais')
      .select('empresa_id, empresas!inner(id, empresa_tipo, ativo)')
      .eq('profissional_id', professional_id)
      .eq('ativo', true)
      .eq('empresas.empresa_tipo', 'tenant')
      .eq('empresas.ativo', true)

    if (linksError) throw linksError
    const currentTenantIds = [...new Set((currentLinks ?? []).map((link: { empresa_id: string }) => link.empresa_id))]
    if (currentTenantIds.some((id) => id !== tenant_empresa_id)) {
      throw new Error('TENANT_REASSIGNMENT_FORBIDDEN')
    }

    const { data: link, error: linkError } = await supabaseAdmin
      .from('empresa_profissionais')
      .upsert({
        profissional_id,
        empresa_id: tenant_empresa_id,
        funcao: 'Admin',
        role: 'admin',
        ativo: true
      }, { onConflict: 'empresa_id,profissional_id' })
      .select('id, empresa_id')
      .single()

    if (linkError) throw linkError

    return new Response(JSON.stringify({
      success: true,
      message: `Admin vinculado ao tenant ${tenant.nome}.`,
      professional: { id: professional.id, email: professional.email, role: professional.role },
      tenant_link: link
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (error) {
    const err = error as Error
    console.error('[bootstrap-admin-tenant]', err.message)
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: err.message.startsWith('UNAUTHORIZED') ? 401 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
