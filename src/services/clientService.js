import { supabase } from './supabase';
import { resolveTenantContext } from '../utils/resolveTenantContext';

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
        const { mode, tenantId, role } = await resolveTenantContext();

        // Super admins don't manage operational companies
        if (mode === 'super_admin') {
            return [];
        }

        // Staff cannot list companies
        if (role === 'staff') {
            throw new Error('Operation not allowed for staff');
        }

        const { data, error } = await supabase
            .from('empresas')
            .select('*')
            .eq('empresa_tipo', 'operacional')
            .eq('tenant_id', tenantId)
            .order('nome');

        if (error) throw error;
        return data;
    },

    create: async (clientData) => {
        const { mode, tenantId, role } = await resolveTenantContext();

        // Super admins cannot create operational companies
        if (mode === 'super_admin') {
            throw new Error('Super admins cannot create operational companies');
        }

        // Staff cannot create companies
        if (role === 'staff') {
            throw new Error('Operation not allowed for staff');
        }

        const { data, error } = await supabase
            .from('empresas')
            .insert([{
                ...clientData,
                empresa_tipo: 'operacional',
                tenant_id: tenantId
            }])
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    update: async (id, updates) => {
        const { mode, tenantId, role } = await resolveTenantContext();

        // Super admins cannot update operational companies
        if (mode === 'super_admin') {
            throw new Error('Super admins cannot update operational companies');
        }

        // Staff cannot update companies
        if (role === 'staff') {
            throw new Error('Operation not allowed for staff');
        }

        // Ensure tenant_id is not modified
        const { tenant_id, empresa_tipo, ...safeUpdates } = updates;

        const { data, error } = await supabase
            .from('empresas')
            .update(safeUpdates)
            .eq('id', id)
            .eq('tenant_id', tenantId) // Extra safety: ensure it belongs to this tenant
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    delete: async (id) => {
        const { mode, tenantId, role } = await resolveTenantContext();

        // Super admins cannot delete operational companies
        if (mode === 'super_admin') {
            throw new Error('Super admins cannot delete operational companies');
        }

        // Staff cannot delete companies
        if (role === 'staff') {
            throw new Error('Operation not allowed for staff');
        }

        const { error } = await supabase
            .from('empresas')
            .delete()
            .eq('id', id)
            .eq('tenant_id', tenantId); // Extra safety: ensure it belongs to this tenant

        if (error) throw error;
    }
};
