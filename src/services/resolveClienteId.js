import { supabase } from './supabase'

/**
 * Resolve clienteId for any user role:
 * - admin/super_admin: looks up clientes table where the user is the admin profissional
 * - staff/profissional: looks up cliente_profissionais active membership
 *
 * @param {string} professionalId - auth.uid() / profissional.id
 * @param {string} role - role from AuthContext
 * @returns {Promise<string|null>} clienteId or null
 */
export async function resolveClienteId(professionalId, role) {
    if (!professionalId) return null

    // Strategy 1: via cliente_profissionais (works for staff/profissional and admins that also have this link)
    const { data: cpData } = await supabase
        .from('cliente_profissionais')
        .select('cliente_id')
        .eq('profissional_id', professionalId)
        .eq('ativo', true)
        .limit(1)
        .maybeSingle()

    if (cpData?.cliente_id) return cpData.cliente_id

    // Strategy 2: admin fallback — look for a cliente where the user is in the empresas network
    // Admins are linked to clientes via empresas → profissionais → clientes
    const { data: empData } = await supabase
        .from('empresas')
        .select('cliente_id')
        .eq('responsavel_id', professionalId)
        .eq('ativo', true)
        .limit(1)
        .maybeSingle()

    if (empData?.cliente_id) return empData.cliente_id

    // Strategy 3: fall back to any cliente related to this profissional's empresa
    const { data: profEmpData } = await supabase
        .from('profissionais')
        .select('empresa_id, empresas!inner(cliente_id)')
        .eq('id', professionalId)
        .limit(1)
        .maybeSingle()

    if (profEmpData?.empresas?.cliente_id) return profEmpData.empresas.cliente_id

    return null
}
