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
        console.log('AuthContext: Calling supabase.auth.signInWithPassword');

        // Timeout race to prevent infinite hanging
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Login timed out (15s)')), 15000)
        );

        const { data, error } = await Promise.race([
            supabase.auth.signInWithPassword({
                email,
                password,
            }),
            timeoutPromise
        ]);

        console.log('AuthContext: signInWithPassword result:', { data, error });
        if (error) throw error;

        // Carregar perfil do usuário
        console.log('AuthContext: Fetching profile for user', data.user.id);
        let profileData = null;
        try {
            profileData = await getProfissionalProfile(data.user.id);
            console.log('AuthContext: Profile fetched', profileData);
        } catch (profileError) {
            console.warn('AuthContext: Could not fetch profile (user might not be in profissionais table yet)', profileError);
            // Non-fatal error for login, but might affect routing. 
            // We return null profile.
        }
        setProfile(profileData);

        return profileData;
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
