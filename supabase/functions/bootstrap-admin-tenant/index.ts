import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

interface BootstrapRequest {
  professional_id: string
  tenant_empresa_id?: string // Optional: specific tenant company ID
  funcao?: string // Optional: function/role name
}

interface BootstrapResponse {
  success: boolean
  message: string
  professional?: {
    id: string
    email: string
    role: string
  }
  tenant_link?: {
    id: string
    empresa_id: string
    empresa_nome: string
  }
  error?: string
}

/**
 * Bootstrap Admin Tenant - Edge Function
 * 
 * Automatically creates tenant link for admin users
 * This ensures no admin can exist without valid tenant context
 * 
 * Called:
 * - When creating new admin
 * - When promoting user to admin
 * - When migrating/restoring admin users
 * 
 * NEVER depends on frontend or manual action
 */
Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const { professional_id, tenant_empresa_id, funcao = 'Administração' } = 
      await req.json() as BootstrapRequest

    if (!professional_id) {
      throw new Error('professional_id is required')
    }

    // 1. Get professional data
    const { data: professional, error: profError } = await supabaseClient
      .from('profissionais')
      .select('id, email, role, ativo')
      .eq('id', professional_id)
      .single()

    if (profError) {
      console.error('[Bootstrap] Professional query failed:', profError)
      throw new Error(`Professional not found: ${profError.message}`)
    }

    if (!professional) {
      throw new Error(`Professional ${professional_id} does not exist`)
    }

    if (!professional.ativo) {
      throw new Error(`Professional ${professional.email} is deactivated`)
    }

    // 2. Only bootstrap for admins
    if (professional.role !== 'admin') {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `User ${professional.email} is not admin (role: ${professional.role}). No bootstrap needed.`,
          professional 
        } satisfies BootstrapResponse),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    // 3. Check if admin already has active tenant link
    const { data: existingLinks, error: linksError } = await supabaseClient
      .from('empresa_profissionais')
      .select(`
        id,
        empresa_id,
        ativo,
        empresas!inner(
          id,
          nome,
          empresa_tipo,
          ativo
        )
      `)
      .eq('profissional_id', professional_id)
      .eq('ativo', true)
      .eq('empresas.empresa_tipo', 'tenant')
      .eq('empresas.ativo', true)

    if (linksError) {
      console.error('[Bootstrap] Links query failed:', linksError)
      throw new Error(`Failed to check existing links: ${linksError.message}`)
    }

    if (existingLinks && existingLinks.length > 0) {
      const link = existingLinks[0]
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `Admin ${professional.email} already has ${existingLinks.length} active tenant link(s)`,
          professional,
          tenant_link: {
            id: link.id,
            empresa_id: link.empresa_id,
            empresa_nome: link.empresas.nome
          }
        } satisfies BootstrapResponse),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200
        }
      )
    }

    // 4. Determine target tenant empresa
    let targetTenantId = tenant_empresa_id

    if (!targetTenantId) {
      // Auto-discover first active tenant
      const { data: tenants, error: tenantError } = await supabaseClient
        .from('empresas')
        .select('id, nome')
        .eq('empresa_tipo', 'tenant')
        .eq('ativo', true)
        .order('created_at', { ascending: true })
        .limit(1)

      if (tenantError) {
        console.error('[Bootstrap] Tenant query failed:', tenantError)
        throw new Error(`Failed to find tenant: ${tenantError.message}`)
      }

      if (!tenants || tenants.length === 0) {
        throw new Error(
          'CRITICAL: No active tenant empresa found in system. ' +
          'Cannot bootstrap admin without tenant. Create tenant empresa first.'
        )
      }

      targetTenantId = tenants[0].id
      console.info(`[Bootstrap] Auto-selected tenant: ${tenants[0].nome} (${tenants[0].id})`)
    }

    // 5. Validate target tenant exists and is active
    const { data: targetTenant, error: tenantValidationError } = await supabaseClient
      .from('empresas')
      .select('id, nome, empresa_tipo, ativo')
      .eq('id', targetTenantId)
      .single()

    if (tenantValidationError || !targetTenant) {
      throw new Error(`Target tenant ${targetTenantId} not found`)
    }

    if (targetTenant.empresa_tipo !== 'tenant') {
      throw new Error(
        `Invalid target: ${targetTenant.nome} is tipo '${targetTenant.empresa_tipo}', must be 'tenant'`
      )
    }

    if (!targetTenant.ativo) {
      throw new Error(`Target tenant ${targetTenant.nome} is deactivated`)
    }

    // 6. Create tenant link (ATOMIC BOOTSTRAP)
    const { data: newLink, error: insertError } = await supabaseClient
      .from('empresa_profissionais')
      .insert({
        profissional_id: professional_id,
        empresa_id: targetTenantId,
        funcao: funcao,
        ativo: true
      })
      .select()
      .single()

    if (insertError) {
      console.error('[Bootstrap] Insert failed:', insertError)
      throw new Error(`Failed to create tenant link: ${insertError.message}`)
    }

    console.info(
      `[Bootstrap] SUCCESS: Created tenant link for ${professional.email} ` +
      `-> ${targetTenant.nome} (${targetTenantId})`
    )

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Admin ${professional.email} bootstrapped successfully with tenant ${targetTenant.nome}`,
        professional,
        tenant_link: {
          id: newLink.id,
          empresa_id: targetTenantId,
          empresa_nome: targetTenant.nome
        }
      } satisfies BootstrapResponse),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 201
      }
    )

  } catch (error) {
    console.error('[Bootstrap] Error:', error)
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Unknown error occurred',
        message: 'Failed to bootstrap admin tenant link'
      } satisfies BootstrapResponse),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
