import { supabase } from './supabase';

export const professionalService = {
    // Buscar todos os profissionais
    getAll: async () => {
        const { data, error } = await supabase
            .from('profissionais')
            .select(`
        *,
        departamentos (id, nome, cor_hex)
      `)
            .order('nome');

        if (error) throw error;
        return data;
    },

    // Criar novo profissional
    create: async (professionalData) => {
        // Gerar um ID se não existir (para tabelas que não auto-geram ou link com auth manual)
        // Nota: Idealmente, chamaria uma Edge Function para criar o Auth User primeiro.
        // Aqui estamos criando apenas o registro no banco para visualização.
        const payload = {
            id: crypto.randomUUID(),
            ...professionalData
        };

        const { data, error } = await supabase
            .from('profissionais')
            .insert([payload])
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    // Atualizar profissional
    update: async (id, updates) => {
        const { data, error } = await supabase
            .from('profissionais')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    // Deletar (ou inativar) profissional
    delete: async (id) => {
        // Opção 1: Hard delete
        const { error } = await supabase
            .from('profissionais')
            .delete()
            .eq('id', id);

        if (error) throw error;
    },

    // Toggle status (Ativo/Inativo)
    toggleStatus: async (id, currentStatus) => {
        const { data, error } = await supabase
            .from('profissionais')
            .update({ ativo: !currentStatus })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data;
    }
};
