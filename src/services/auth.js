import { supabase } from './supabase';

/**
 * Faz login com email e senha
 */
export const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) throw error;
    return data;
};

/**
 * Faz logout
 */
export const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
};

/**
 * Obtém a sessão atual
 */
export const getSession = async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    return session;
};

/**
 * Obtém o usuário atual
 */
export const getUser = async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    return user;
};

/**
 * Verifica se o usuário é admin
 */
export const isAdmin = async () => {
    const user = await getUser();
    if (!user) return false;

    const { data, error } = await supabase
        .from('profissionais')
        .select('role')
        .eq('id', user.id)
        .single();

    if (error) {
        console.error('Erro ao verificar role:', error);
        return false;
    }

    return data?.role === 'admin';
};

/**
 * Obtém o perfil completo do profissional
 */
export const getProfissionalProfile = async (userId) => {
    const { data, error } = await supabase
        .from('profissionais')
        .select(`
      *,
      departamento:departamentos(id, nome, cor_hex)
    `)
        .eq('id', userId)
        .single();

    if (error) throw error;
    return data;
};
