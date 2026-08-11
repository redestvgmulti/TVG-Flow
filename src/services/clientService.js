import { supabase } from './supabase';

async function getFunctionError(error, fallbackMessage) {
    if (error?.context) {
        const body = await error.context.json().catch(() => null);
        if (body?.error) return body.error;
    }

    return error?.message || fallbackMessage;
}


/**
 * Client Service - Manages operational companies (empresas operacionais)
 * 
 * CRITICAL RULES:
 * - empresas is the ONLY source of truth
 * - clientes table is DEPRECATED
 * - Super admins do NOT see operational companies
 * - Admins only see companies linked to their tenant
 */

export const clientService = {
    getAll: async () => {
        // 🔒 RBAC: Rely on RLS + Backend Identity
        const { data: identity, error: idError } = await supabase.rpc('get_current_identity');
        if (idError || !identity) throw new Error('Falha ao identificar usuário');

        // Super admins don't manage operational companies via this service
        if (identity.role === 'super_admin') {
            return [];
        }

        // Staff cannot list companies
        if (identity.role === 'staff') {
            throw new Error('Operation not allowed for staff');
        }

        // RLS automatically filters by tenant via `empresa_profissionais`
        const { data, error } = await supabase
            .from('empresas')
            .select('*')
            .eq('empresa_tipo', 'operacional')
            .eq('ativo', true)
            .order('nome');

        if (error) throw error;
        return data;
    },

    create: async (clientData) => {
        const { data: identity, error: idError } = await supabase.rpc('get_current_identity');
        if (idError || !identity) throw new Error('Falha ao identificar usuário');

        // Super admins cannot create operational companies
        if (identity.role === 'super_admin') {
            throw new Error('Super admins cannot create operational companies');
        }

        // Staff cannot create companies
        if (identity.role === 'staff') {
            throw new Error('Operation not allowed for staff');
        }

        // Insert: RLS will enforce tenant_id assignment or trigger will handle it
        // Note: Ideally the backend trigger assigns tenant_id based on creator's context.
        // If we must pass it, we'd need to fetch it. 
        // Assuming strict backend triggers for now or that RLS policy allows insert and defaults it.
        // If explicit tenant_id is needed, we create a specific RPC `create_client` preferably.
        // However, for this refactor, let's assume RLS policy inserts `tenant_id` or we query it safely.

        // SAFE FALLBACK: Query one company to get tenant_id if not auto-injected by trigger
        // Validation: Admin must belong to a tenant.

        const { data: myCompany } = await supabase
            .from('empresas')
            .select('tenant_id')
            .eq('empresa_tipo', 'tenant')
            .limit(1)
            .single();

        if (!myCompany?.tenant_id) throw new Error('Tenant context not found for Admin');

        const { data, error } = await supabase
            .from('empresas')
            .insert([{
                ...clientData,
                empresa_tipo: 'operacional',
                tenant_id: myCompany.tenant_id
            }])
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    update: async (id, updates) => {
        const { data: identity, error: idError } = await supabase.rpc('get_current_identity');
        if (idError || !identity) throw new Error('Falha ao identificar usuário');

        if (identity.role === 'super_admin') {
            throw new Error('Super admins cannot update operational companies');
        }

        if (identity.role === 'staff') {
            throw new Error('Operation not allowed for staff');
        }

        // Ensure tenant_id is not modified
        const { tenant_id, empresa_tipo, ...safeUpdates } = updates;

        // RLS ensures we can only update our own companies
        const { data, error } = await supabase
            .from('empresas')
            .update(safeUpdates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    delete: async (id) => {
        const { data: identity, error: idError } = await supabase.rpc('get_current_identity');
        if (idError || !identity) throw new Error('Falha ao identificar usuário');

        if (identity.role === 'super_admin') {
            throw new Error('Super admins cannot delete operational companies');
        }

        if (identity.role === 'staff') {
            throw new Error('Operation not allowed for staff');
        }

        const { data, error } = await supabase.functions.invoke('deactivate-company', {
            body: { company_id: id }
        });

        if (error) throw new Error(await getFunctionError(error, 'Erro ao desativar empresa'));
        if (data?.error) throw new Error(data.error);

        return data;
    }
};
