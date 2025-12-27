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
    const [accountStatus, setAccountStatus] = useState('active') // 'active' | 'inactive' | 'suspended'
    const [connectionStatus, setConnectionStatus] = useState('online') // 'online' | 'offline' | 'reconnecting'

    // Detectar erro de rede
    function isNetworkError(error) {
        return (
            error?.message?.includes('fetch') ||
            error?.message?.includes('network') ||
            error?.status === 0 ||
            !navigator.onLine
        )
    }

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session }, error }) => {
            if (error) {
                console.error('Error getting session:', error)

                // Diferenciar erro de rede vs sessão expirada
                if (isNetworkError(error)) {
                    setConnectionStatus('offline')
                    // NÃO deslogar, apenas informar
                } else {
                    // Outros erros: apenas log, deixar Supabase Auth gerenciar
                    console.error('Session error (not network):', error)
                }

                setLoading(false)
                return
            }

            setSession(session)
            setUser(session?.user ?? null)
            if (session?.user) {
                fetchProfessionalData(session.user.id)
            } else {
                setLoading(false)
            }
        }).catch(err => {
            console.error('Unexpected error during session init:', err)
            setLoading(false)
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

    // Retry silencioso em reconexão
    useEffect(() => {
        const handleOnline = async () => {
            if (connectionStatus === 'offline') {
                setConnectionStatus('reconnecting')

                try {
                    // Tentar recuperar sessão
                    const { data: { session }, error } = await supabase.auth.getSession()

                    if (!error && session) {
                        setConnectionStatus('online')
                        setSession(session)
                        setUser(session.user)
                        fetchProfessionalData(session.user.id)
                    } else {
                        setConnectionStatus('online')
                    }
                } catch (err) {
                    console.error('Error during reconnection:', err)
                    setConnectionStatus('online')
                }
            }
        }

        window.addEventListener('online', handleOnline)
        return () => window.removeEventListener('online', handleOnline)
    }, [connectionStatus])

    async function fetchProfessionalData(userId) {
        try {
            const { data: professional, error } = await supabase
                .from('profissionais')
                .select('id, role, nome, ativo')
                .eq('id', userId)
                .maybeSingle()

            // Fetch company association separately to avoid relationship issues
            const { data: companyData } = await supabase
                .from('empresa_profissionais')
                .select(`
                    empresa:empresas (
                        status_conta
                    )
                `)
                .eq('profissional_id', userId)
                .maybeSingle()

            // Merge company data into professional object
            if (professional) {
                professional.empresa_profissionais = companyData ? [companyData] : []
            }

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
                setAccountStatus('inactive')
                setRole(professional.role || null)
                setProfessionalId(professional.id || null)
                setProfessionalName(professional.nome || null)
                setLoading(false)
                return
            }

            // Super admins don't have company associations - set their state immediately
            if (professional.role === 'super_admin') {
                setRole('super_admin')
                setProfessionalId(professional.id || null)
                setProfessionalName(professional.nome || null)
                setAccountStatus('active')
                setLoading(false)
                return
            }

            // SECURITY: Check if company is suspended (only for non-super_admin users)
            const companyStatus = professional.empresa_profissionais?.[0]?.empresa?.status_conta
            if (companyStatus === 'suspended') {
                setAccountStatus('suspended')
                setRole(professional.role || null)
                setProfessionalId(professional.id || null)
                setProfessionalName(professional.nome || null)
                setLoading(false)
                return
            }

            // All checks passed, set user data
            setRole(professional.role || null)
            setProfessionalId(professional.id || null)
            setProfessionalName(professional.nome || null)
            setAccountStatus('active')
            setLoading(false)
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
        accountStatus,
        connectionStatus,
        signIn,
        signOut
    }

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    )
}
