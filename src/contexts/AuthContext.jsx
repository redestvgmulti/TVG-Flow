import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../services/supabase'

const AuthContext = createContext({})

export function useAuth() {
    return useContext(AuthContext)
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null)
    const [session, setSession] = useState(null)
    const [loading, setLoading] = useState(true)
    const [role, setRole] = useState(null)
    const [professionalId, setProfessionalId] = useState(null)
    const [professionalName, setProfessionalName] = useState(null)

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session)
            setUser(session?.user ?? null)
            if (session?.user) {
                fetchProfessionalData(session.user.id)
            } else {
                setLoading(false)
            }
        })

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session)
            setUser(session?.user ?? null)
            if (session?.user) {
                fetchProfessionalData(session.user.id)
            } else {
                setRole(null)
                setProfessionalId(null)
                setProfessionalName(null)
                setLoading(false)
            }
        })

        return () => subscription.unsubscribe()
    }, [])

    async function fetchProfessionalData(userId) {
        try {
            const { data: professional, error } = await supabase
                .from('profissionais')
                .select(`
                    id, 
                    role, 
                    nome, 
                    ativo,
                    empresa_profissionais (
                        empresa:empresas (
                            status_conta
                        )
                    )
                `)
                .eq('id', userId)
                .maybeSingle()

            if (error) {
                setRole(null)
                setProfessionalId(null)
                setProfessionalName(null)
                setLoading(false)
                return
            }

            // If no professional found, clear state
            if (!professional) {
                setRole(null)
                setProfessionalId(null)
                setProfessionalName(null)
                setLoading(false)
                return
            }

            // SECURITY: Check if user is active
            if (!professional.ativo) {
                await signOut()
                return
            }

            // SECURITY: Check if company is suspended
            const companyStatus = professional.empresa_profissionais?.[0]?.empresa?.status_conta
            if (companyStatus === 'suspended') {
                await signOut()
                window.location.href = '/suspended'
                return
            }

            setRole(professional.role || null)
            setProfessionalId(professional.id || null)
            setProfessionalName(professional.nome || null)
        } catch (error) {
            setRole(null)
            setProfessionalId(null)
            setProfessionalName(null)
        } finally {
            setLoading(false)
        }
    }

    async function signIn(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        })

        if (error) throw error

        // Fetch role immediately to allow redirect logic
        const { data: prof, error: profError } = await supabase
            .from('profissionais')
            .select('role')
            .eq('id', data.user.id)
            .single()

        if (profError) console.error('Error fetching role during login:', profError)

        return { ...data, role: prof?.role }
    }

    async function signOut() {
        const { error } = await supabase.auth.signOut()
        if (error) throw error

        setRole(null)
        setProfessionalId(null)
        setProfessionalName(null)
    }

    const value = {
        user,
        session,
        loading,
        role,
        professionalId,
        professionalName,
        signIn,
        signOut
    }

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    )
}
