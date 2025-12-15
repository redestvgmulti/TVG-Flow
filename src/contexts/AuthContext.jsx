import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabase';
import { getProfissionalProfile } from '../services/auth';

const AuthContext = createContext({});

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth deve ser usado dentro de um AuthProvider');
    }
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Verificar sessão atual
        checkUser();

        // Escutar mudanças de autenticação
        const { data: authListener } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                if (session?.user) {
                    setUser(session.user);
                    await loadProfile(session.user.id);
                } else {
                    setUser(null);
                    setProfile(null);
                }
                setLoading(false);
            }
        );

        return () => {
            authListener?.subscription?.unsubscribe();
        };
    }, []);

    const checkUser = async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                setUser(session.user);
                await loadProfile(session.user.id);
            }
        } catch (error) {
            console.error('Erro ao verificar usuário:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadProfile = async (userId) => {
        try {
            const profileData = await getProfissionalProfile(userId);
            setProfile(profileData);
        } catch (error) {
            console.error('Erro ao carregar perfil:', error);
            setProfile(null);
        }
    };

    const signIn = async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) throw error;
        return data;
    };

    const signOut = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        setUser(null);
        setProfile(null);
    };

    const isAdmin = () => {
        return profile?.role === 'admin';
    };

    const value = {
        user,
        profile,
        loading,
        signIn,
        signOut,
        isAdmin,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
