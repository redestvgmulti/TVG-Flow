import { supabase } from './supabase';

export const clientService = {
    getAll: async () => {
        const { data, error } = await supabase
            .from('clientes')
            .select('*')
            .order('nome');

        if (error) throw error;
        return data;
    },

    create: async (clientData) => {
        const { data, error } = await supabase
            .from('clientes')
            .insert([clientData])
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    update: async (id, updates) => {
        const { data, error } = await supabase
            .from('clientes')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    delete: async (id) => {
        const { error } = await supabase
            .from('clientes')
            .delete()
            .eq('id', id);

        if (error) throw error;
    }
};
