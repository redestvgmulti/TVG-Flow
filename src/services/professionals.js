
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
                clientes (id, nome)
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
    async getFunctionsByCompany(companyId) {
        const { data, error } = await supabase
            .from('empresa_profissionais')
            .select('funcao')
            .eq('empresa_id', companyId)
            .eq('ativo', true)

        if (error) throw error
        // Retorna lista única de funções
        return [...new Set(data.map(item => item.funcao))]
    }
}
