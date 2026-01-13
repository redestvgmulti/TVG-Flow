import { supabase } from '../services/supabase';

/**
 * HARDENED Tenant Context Resolution
 * 
 * Returns:
 * - { mode: 'super_admin', tenantId: null, role: 'super_admin' } for super admins
 * - { mode: 'tenant', tenantId: UUID, role: 'admin' | 'staff' } for admins/staff
 * 
 * Throws explicit, actionable errors with debugging info if context cannot be resolved
 * 
 * STRUCTURAL GUARANTEE:
 * - Database triggers prevent admins without tenant
 * - This function adds runtime validation layer
 * - Errors here indicate critical system integrity violation
 */
export async function resolveTenantContext() {
    // ========================================
    // STEP 1: Authentication Validation
    // ========================================
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError) {
        if (import.meta.env.DEV) {
            console.error('[TenantContext] Authentication error:', authError);
        }
        throw new Error(`AUTHENTICATION_ERROR: ${authError.message}`);
    }

    if (!user) {
        throw new Error('AUTHENTICATION_REQUIRED: User not authenticated');
    }

    // ========================================
    // STEP 2: Professional Record Validation
    // ========================================
    const { data: professional, error: profError } = await supabase
        .from('profissionais')
        .select('role, email, ativo')
        .eq('id', user.id)
        .single();

    if (profError) {
        if (import.meta.env.DEV) {
            console.error('[TenantContext] Professional query error:', profError);
        }
        throw new Error(`PROFESSIONAL_NOT_FOUND: ${profError.message}`);
    }

    if (!professional) {
        if (import.meta.env.DEV) {
            console.error('[TenantContext] No professional record found for user');
        }
        throw new Error(
            `PROFESSIONAL_NOT_FOUND: No professional record exists. ` +
            `This indicates database integrity issue.`
        );
    }

    if (!professional.ativo) {
        throw new Error(
            `PROFESSIONAL_INACTIVE: Account is deactivated. ` +
            `Contact your administrator to reactivate.`
        );
    }

    // ========================================
    // STEP 3: Super Admin Validation
    // ========================================
    const IMMUTABLE_SUPER_ADMIN_EMAIL = 'geovanepanini@icloud.com';
    let effectiveRole = professional.role;

    // Security: Only specific email can be super_admin
    if (effectiveRole === 'super_admin' && user.email !== IMMUTABLE_SUPER_ADMIN_EMAIL) {
        if (import.meta.env.DEV) {
            console.warn('[TenantContext] SECURITY: Unauthorized super_admin detected, downgrading');
        }
        effectiveRole = 'admin';
    }

    if (effectiveRole === 'super_admin') {
        if (import.meta.env.DEV) {
            console.info(`[TenantContext] Super admin access granted`);
        }
        return {
            mode: 'super_admin',
            tenantId: null,
            role: 'super_admin'
        };
    }

    // ========================================
    // STEP 4: Company Links Validation
    // ========================================
    const { data: links, error: linksError } = await supabase
        .from('empresa_profissionais')
        .select(`
            empresa_id,
            ativo,
            funcao,
            empresas!inner(
                id,
                nome,
                empresa_tipo,
                tenant_id,
                ativo
            )
        `)
        .eq('profissional_id', user.id)
        .eq('ativo', true)
        .eq('empresas.ativo', true);

    if (linksError) {
        if (import.meta.env.DEV) {
            console.error('[TenantContext] Links query error:', linksError);
        }
        throw new Error(`DATABASE_ERROR: ${linksError.message}`);
    }

    // ========================================
    // STEP 5: CRITICAL - Admin Must Have Links
    // ========================================
    if (effectiveRole === 'admin' && (!links || links.length === 0)) {
        if (import.meta.env.DEV) {
            console.error('[TenantContext] CRITICAL: Admin without company links - database integrity violated');
        }

        throw new Error(
            `CRITICAL_INTEGRITY_VIOLATION: Admin has no active company links. ` +
            `This should be IMPOSSIBLE due to database constraints. ` +
            `System may be in inconsistent state. Contact technical support immediately with error code: ADMIN_NO_TENANT`
        );
    }

    // Staff might have no links (different use case)
    if (!links || links.length === 0) {
        if (effectiveRole === 'staff') {
            throw new Error(
                `NO_COMPANY_ACCESS: Staff user is not assigned to any active company. ` +
                `Contact your administrator to be assigned to a company.`
            );
        }

        // Unexpected role
        throw new Error(
            `INVALID_STATE: User with role '${effectiveRole}' has no active company links.`
        );
    }

    // ========================================
    // STEP 6: Resolve Tenant ID
    // ========================================
    // Priority: empresa tipo 'tenant' > tenant_id from any empresa
    const tenantLink = links.find(l => l.empresas.empresa_tipo === 'tenant');
    const tenantId = tenantLink?.empresa_id || links[0]?.empresas?.tenant_id;

    if (!tenantId) {
        if (import.meta.env.DEV) {
            console.error('[TenantContext] CRITICAL: No tenant_id resolved', {
                links_count: links.length,
                empresas_details: links.map(l => ({
                    nome: l.empresas.nome,
                    tipo: l.empresas.empresa_tipo,
                    tenant_id: l.empresas.tenant_id
                }))
            });
        }

        throw new Error(
            `TENANT_NOT_RESOLVED: Could not determine tenant. ` +
            `Found ${links.length} company link(s) but none have valid tenant reference. ` +
            `This indicates database schema or data integrity issue. Contact technical support.`
        );
    }

    // ========================================
    // SUCCESS - Return
    // ========================================
    if (import.meta.env.DEV) {
        console.info('[TenantContext] Context resolved successfully', {
            role: effectiveRole,
            mode: 'tenant',
            company_count: links.length
        });
    }

    return {
        mode: 'tenant',
        tenantId,
        role: effectiveRole
    };
}
