import { supabase } from '../services/supabase';

/**
 * Centralized tenant context resolution
 * 
 * Returns:
 * - { mode: 'super_admin', tenantId: null, role: 'super_admin' } for super admins
 * - { mode: 'tenant', tenantId: UUID, role: 'admin' | 'staff' } for admins/staff
 * 
 * Throws if user is not authenticated or tenant context cannot be resolved
 */
export async function resolveTenantContext() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data: professional, error: profError } = await supabase
        .from('profissionais')
        .select('role')
        .eq('id', user.id)
        .single();

    if (profError || !professional) {
        throw new Error('Professional not found');
    }

    const IMMUTABLE_SUPER_ADMIN_EMAIL = 'geovanepanini@agencyflow.com';
    let effectiveRole = professional.role;

    // RULE: Only the specific email can be super_admin. Downgrade everyone else.
    if (effectiveRole === 'super_admin' && user.email !== IMMUTABLE_SUPER_ADMIN_EMAIL) {
        console.warn(`TenantContext: Downgrading ${user.email} from super_admin to admin`);
        effectiveRole = 'admin';
    }

    if (effectiveRole === 'super_admin') {
        return { mode: 'super_admin', tenantId: null, role: 'super_admin' };
    }

    const { data: links, error } = await supabase
        .from('empresa_profissionais')
        .select('empresa_id, empresas!inner(empresa_tipo, tenant_id)')
        .eq('profissional_id', user.id)
        .eq('ativo', true);

    if (error || !links?.length) {
        throw new Error('Tenant context not found');
    }

    const tenantLink = links.find(l => l.empresas.empresa_tipo === 'tenant');
    const tenantId = tenantLink?.empresa_id || links[0]?.empresas?.tenant_id;

    if (!tenantId) {
        throw new Error('Tenant context not found');
    }

    return { mode: 'tenant', tenantId, role: effectiveRole };
}
