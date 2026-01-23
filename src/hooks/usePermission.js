import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../services/supabase'

export function usePermission() {
    const { role } = useAuth()

    const isSuperAdmin = () => role === 'super_admin'
    const isAdmin = () => role === 'admin'
    const isStaff = () => role === 'staff' || role === 'profissional'

    const canCreateOS = async (empresaId, clienteId) => {
        const { data, error } = await supabase.rpc('can_create_os', {
            p_empresa_id: empresaId,
            p_cliente_id: clienteId,
        })
        if (error) return false
        return data === true
    }

    const canCreateWorkflowOS = async (empresaId, clienteId) => {
        const { data, error } = await supabase.rpc('can_create_workflow_os', {
            p_empresa_id: empresaId,
            p_cliente_id: clienteId,
        })
        if (error) return false
        return data === true
    }

    const canAssignProfessional = async (clienteId, profissionalId, funcao) => {
        const { data, error } = await supabase.rpc('can_assign_professional', {
            p_cliente_id: clienteId,
            p_profissional_id: profissionalId,
            p_funcao: funcao,
        })
        if (error) return false
        return data === true
    }

    const canViewCliente = async (clienteId) => {
        const { data, error } = await supabase.rpc('can_view_cliente', {
            p_cliente_id: clienteId
        })
        if (error) return false
        return data === true
    }

    return {
        role,
        isSuperAdmin,
        isAdmin,
        isStaff,
        canCreateOS,
        canCreateWorkflowOS,
        canAssignProfessional,
        canViewCliente
    }
}
