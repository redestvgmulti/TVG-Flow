
import { supabase } from './supabase'

export const professionalsService = {
    // List all professionals (Admin only via RLS)
    async list() {
        const { data, error } = await supabase
            .from('profissionais')
            .select('id, nome, email, role, ativo, created_at, area_id, areas(nome)')
            .order('created_at', { ascending: false })

        if (error) throw error
        return data
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
        // Payload: { nome, email, password, role, area_id }
        const { data, error } = await supabase.functions.invoke('create-professional', {
            body: payload
        })

        if (error) throw new Error(error.message || 'Erro de conexão com o servidor')
        if (data?.error) throw new Error(data.error)

        return data
    },

    // Update professional (Direct DB update for non-auth fields)
    async update(id, payload) {
        // Payload: { nome, role, ativo, area_id }
        const { error } = await supabase
            .from('profissionais')
            .update(payload)
            .eq('id', id)

        if (error) throw error
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
    }
}
