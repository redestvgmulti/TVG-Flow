import { supabase } from './supabase';

export const departmentService = {
    getAll: async () => {
        const { data, error } = await supabase
            .from('departamentos')
            .select('*')
            .order('nome');

        if (error) throw error;
        return data;
    },

    create: async (departmentData) => {
        const { data, error } = await supabase
            .from('departamentos')
            .insert([departmentData])
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    update: async (id, updates) => {
        const { data, error } = await supabase
            .from('departamentos')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    delete: async (id) => {
        const { error } = await supabase
            .from('departamentos')
            .delete()
            .eq('id', id);

        if (error) throw error;
    }
};
