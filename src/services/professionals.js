
import { supabase } from './supabase'

export const professionalsService = {
    // List all professionals (Admin only via RLS)
    async list() {
        // First get all professionals
        const { data: professionals, error: profError } = await supabase
            .from('profissionais')
            .select('id, nome, email, role, ativo, created_at')
            .order('created_at', { ascending: false })

        if (profError) throw profError

        // Then get company counts for each professional
        const { data: companyCounts, error: countError } = await supabase
            .from('empresa_profissionais')
            .select('profissional_id')
            .eq('ativo', true)

        if (countError) throw countError

        // Count companies per professional
        const countMap = {}
        companyCounts.forEach(link => {
            countMap[link.profissional_id] = (countMap[link.profissional_id] || 0) + 1
        })

        // Attach counts to professionals
        return professionals.map(prof => ({
            ...prof,
            company_count: countMap[prof.id] || 0
        }))
    },

    // Get single professional
    async getById(id) {
        const { data, error } = await supabase
            .from('profissionais')
            .select('id, nome, email, role, ativo, area_id')
            .eq('id', id)
            .single()

        if (error) throw error
        return data
    },

    // Create professional (via Edge Function)
    async create(payload) {
        // Payload: { nome, email, role, area_id } - Password handled via Email Invite
        const { data, error } = await supabase.functions.invoke('create-professional', {
            body: payload
        })

        if (error) throw new Error(error.message || 'Erro de conexão com o servidor')
        if (data?.error) throw new Error(data.error)

        // Return the full data object which includes inviteLink
        return data
    },

    async update(id, payload) {
        // Payload: { nome, role, ativo, area_id }
        // Using Edge Function to bypass potential RLS restrictions
        const { data, error } = await supabase.functions.invoke('update-professional', {
            body: {
                professional_id: id,
                payload
            }
        })

        if (error) throw new Error(error.message || 'Erro de conexão com o servidor')
        if (data?.error) throw new Error(data.error)

        return true
    },

    // Delete professional (via Edge Function)
    async delete(id) {
        const { data, error } = await supabase.functions.invoke('delete-professional', {
            body: { professional_id: id }
        })

        if (error) throw new Error(error.message || 'Erro de conexão com o servidor')
        if (data?.error) throw new Error(data.error)

        return true
    },

    // Generate manual recovery link (via Edge Function)
    async generateRecoveryLink(email) {
        const { data, error } = await supabase.functions.invoke('generate-recovery-link', {
            body: { email }
        })

        if (error) throw new Error(error.message || 'Erro de conexão com o servidor')
        if (data?.error) throw new Error(data.error)

        return data
    },
    // ============================================================
    // Vínculos Empresa-Profissional (Architecture Refactor)
    // ============================================================

    // Listar vínculos de um profissional
    async getLinks(professionalId) {
        const { data, error } = await supabase
            .from('empresa_profissionais')
            .select(`
                *,
                empresas (id, nome)
            `)
            .eq('profissional_id', professionalId)
            .order('created_at', { ascending: true })

        if (error) throw error
        return data
    },

    // Adicionar vínculo
    async addLink(payload) {
        // payload: { empresa_id, profissional_id, funcao, ativo }
        const { data, error } = await supabase
            .from('empresa_profissionais')
            .insert([payload])
            .select()
            .single()

        if (error) throw error
        return data
    },

    // Remover vínculo
    async removeLink(linkId) {
        const { error } = await supabase
            .from('empresa_profissionais')
            .delete()
            .eq('id', linkId)

        if (error) throw error
        return true
    },

    // Alternar status do vínculo
    async toggleLinkStatus(linkId, currentStatus) {
        const { data, error } = await supabase
            .from('empresa_profissionais')
            .update({ ativo: !currentStatus })
            .eq('id', linkId)
            .select()
            .single()

        if (error) throw error
        return data
    },

    // Buscar funções disponíveis em uma empresa
    // REVERTED TO ORIGINAL: Query empresa_profissionais directly
    // This table already contains the professional-company-function relationship
    async getFunctionsByCompany(companyId) {
        const { data, error } = await supabase
            .from('empresa_profissionais')
            .select('funcao')
            .eq('empresa_id', companyId)
            .eq('ativo', true)

        if (error) throw error

        // Return unique list of function names
        return [...new Set(data.map(item => item.funcao).filter(f => f != null))]
    },

    // ============================================================
    // Permission-Based Professional Listing (Tenant-First Model)
    // ============================================================

    /**
     * Get professionals allowed to work on a specific operational company
     * Uses the permission table (empresa_profissionais_permitidos)
     * Also fetches funcao from empresa_profissionais for workflow compatibility
     * 
     * @param {string} companyId - Operational company ID
     * @returns {Promise<Array>} Professionals with permissions for this company
     */
    async getProfessionalsByCompany(companyId) {
        // First, get professionals allowed on this company
        const { data: permissions, error: permError } = await supabase
            .from('empresa_profissionais_permitidos')
            .select(`
                profissional_id,
                profissionais!inner (
                    id,
                    nome
                )
            `)
            .eq('empresa_operacional_id', companyId)
            .eq('ativo', true)

        if (permError) throw permError

        if (!permissions || permissions.length === 0) {
            return []
        }

        // Get funcao from empresa_profissionais for each allowed professional
        // This maintains backward compatibility with workflow mode
        const professionalIds = permissions.map(p => p.profissional_id)

        const { data: funcoes, error: funcError } = await supabase
            .from('empresa_profissionais')
            .select('profissional_id, funcao')
            .eq('empresa_id', companyId)
            .in('profissional_id', professionalIds)
            .eq('ativo', true)

        if (funcError) throw funcError

        // Create a map of profissional_id -> funcao
        const funcaoMap = {}
        funcoes.forEach(f => {
            funcaoMap[f.profissional_id] = f.funcao
        })

        // Merge permissions and funcoes
        return permissions.map(item => ({
            profissional_id: item.profissional_id,
            funcao: funcaoMap[item.profissional_id] || null,
            profissionais: item.profissionais
        }))
    }
}
