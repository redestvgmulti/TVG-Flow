import { createContext, useContext, useState, useEffect, useRef } from 'react'
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

    // Refs to track state without triggering re-renders and prevent race conditions
    const isFetchingRef = useRef(false)
    const userRef = useRef(null)

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
        let mounted = true

        const initSession = async () => {
            try {
                // Get initial session
                const { data: { session }, error } = await supabase.auth.getSession()

                if (!mounted) return

                if (error) {
                    console.error('Error getting session:', error)

                    // Diferenciar erro de rede vs sessão expirada
                    if (isNetworkError(error)) {
                        setConnectionStatus('offline')
                        // NÃO deslogar sem certeza, apenas informar
                    } else {
                        // Outros erros (ex: refresh token inválido): limpar tudo
                        console.error('Critical session error:', error)
                        setSession(null)
                        setUser(null)
                        userRef.current = null
                    }
                    setLoading(false)
                    return
                }

                if (!session) {
                    // No session found on startup
                    setSession(null)
                    setUser(null)
                    userRef.current = null
                    setLoading(false)
                    return
                }

                // Initial session found
                setSession(session)
                setUser(session.user)
                userRef.current = session.user

                // Fetch data for the initial user
                await fetchProfessionalData(session.user.id, session.user)

            } catch (err) {
                console.error('Unexpected error during session init:', err)
                if (mounted) setLoading(false)
            }
        }

        initSession()

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (!mounted) return
            console.log('Auth State Change:', event)

            if (event === 'TOKEN_REFRESH_FAILED' || event === 'SIGNED_OUT') {
                console.warn('Token Refresh Failed or Signed Out. Cleaning up...')
                setSession(null)
                setUser(null)
                userRef.current = null
                setRole(null)
                setProfessionalId(null)
                setProfessionalName(null)
                setAccountStatus('active') // Reset status

                // CRITICAL: Force redirect to login if session is lost to prevent "half-logged" state
                // Only redirect if NOT already on login page to avoid loops if logic placed improperly
                if (window.location.pathname !== '/login' && window.location.pathname !== '/reset-password') {
                    // Using window.location to force full clean state
                    window.location.href = '/login'
                }

                setLoading(false)
                return
            }

            // Standard session update
            if (session) {
                // Check if user changed (rare, but possible)
                // Use Ref for comparison to avoid closure stale state
                if (session.user.id !== userRef.current?.id) {
                    console.log('AuthContext: User changed or initial load. Fetching data...')
                    setSession(session)
                    setUser(session.user)
                    userRef.current = session.user

                    // Re-fetch data for new user, PASS USER OBJECT to avoid redundant calls
                    await fetchProfessionalData(session.user.id, session.user)
                } else {
                    // Just update session token
                    console.log('AuthContext: Session update only (same user).')
                    setSession(session)
                    // If we are still loading for some reason (rare race), ensure we turn it off
                    // But usually fetchProfessionalData handles it.
                }
            } else {
                // No session provided in event (should be covered by SIGNED_OUT, but safety net)
                if (event !== 'INITIAL_SESSION') {
                    // unexpected state
                }
            }
        })

        return () => {
            mounted = false
            subscription.unsubscribe()
        }
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
                        userRef.current = session.user
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

    async function fetchProfessionalData(userId, userObject = null) {
        // Prevent race conditions and duplicate calls
        if (isFetchingRef.current) {
            console.log('AuthContext: Fetch already in progress for', userId, 'skipping.')
            return
        }

        isFetchingRef.current = true
        console.log('AuthContext: fetchProfessionalData started for', userId)

        // Safety Timeout to prevent infinite loading
        const timeoutId = setTimeout(() => {
            if (isFetchingRef.current) {
                console.error('AuthContext: fetchProfessionalData TIMED OUT. Forcing loading=false.')
                setLoading(false)
                isFetchingRef.current = false
            }
        }, 15000) // 15 seconds max

        try {
            // Get current session user email for validation
            let currentUser = userObject
            if (!currentUser) {
                console.log('AuthContext: No userObject passed, fetching from Supabase...')
                const { data: { user } } = await supabase.auth.getUser()
                currentUser = user
            }

            const userEmail = currentUser?.email
            console.log('AuthContext: User email resolved:', userEmail)

            const IMMUTABLE_SUPER_ADMIN_EMAIL = 'geovanepanini@agencyflow.com'

            // 1. IMMUTABLE SUPER ADMIN CHECK (Overrides DB)
            if (userEmail === IMMUTABLE_SUPER_ADMIN_EMAIL) {
                console.log('AuthContext: Immutable Super Admin Detected')
                setRole('super_admin')
                // Super admin doesn't need specific professional ID for now, or fetch if exists
                // For safety, let's try to fetch name if he exists in DB, otherwise default
                const { data: profile } = await supabase
                    .from('profissionais')
                    .select('id, nome')
                    .eq('email', IMMUTABLE_SUPER_ADMIN_EMAIL)
                    .maybeSingle()

                setProfessionalId(profile?.id || userId)
                setProfessionalName(profile?.nome || 'Super Admin')
                setAccountStatus('active')
                setLoading(false)
                return
            }

            console.log('AuthContext: Fetching standard profile for', userId)

            // 2. FETCH STANDARD DB PROFILE
            const { data: professional, error } = await supabase
                .from('profissionais')
                .select('id, role, nome, ativo')
                .eq('id', userId)
                .maybeSingle()

            if (error) {
                console.error('Error fetching professional:', error)
                setRole(null)
                setProfessionalId(null)
                setProfessionalName(null)
                setLoading(false)
                return
            }

            // If no professional found, clear state
            if (!professional) {
                console.warn('AuthContext: No professional profile found in DB')
                setRole(null)
                setProfessionalId(null)
                setProfessionalName(null)
                setLoading(false)
                return
            }

            // SECURITY: Check if user is active
            if (!professional.ativo) {
                console.warn('AuthContext: Professional account inactive')
                setAccountStatus('inactive')
                setRole(null) // Block access
                setLoading(false)
                return
            }

            // 3. ROLE ENFORCEMENT
            let finalRole = professional.role

            // CRITICAL: Prevent anyone else from being super_admin
            if (finalRole === 'super_admin' && userEmail !== IMMUTABLE_SUPER_ADMIN_EMAIL) {
                console.warn(`Security Alert: User ${userEmail} has 'super_admin' role in DB but is not the Immutable Super Admin. Downgrading to 'admin'.`)
                finalRole = 'admin'
            }

            // --- STANDARD FLOW (Admin / Staff) ---
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

            // SECURITY: Check if company is suspended
            const companyStatus = professional.empresa_profissionais?.[0]?.empresa?.status_conta
            if (companyStatus === 'suspended') {
                setAccountStatus('suspended')
                // We keep the role to allow "Suspended" page to show contextual info if needed, 
                // but routes will block access based on AccountStatus if we implement that check.
                // For now, let's allow role but UI handles "Suspended" page redirect.
            }

            // All checks passed, set user data
            console.log('AuthContext: Professional data loaded successfully. Role:', finalRole)
            setRole(finalRole)
            setProfessionalId(professional.id || null)
            setProfessionalName(professional.nome || null)
            setAccountStatus('active')
            setLoading(false)
        } catch (error) {
            console.error('Auth Context Error:', error)
            setRole(null)
            setProfessionalId(null)
            setProfessionalName(null)
        } finally {
            clearTimeout(timeoutId)
            isFetchingRef.current = false
            console.log('AuthContext: fetchProfessionalData finished. Setting loading=false')
            setLoading(false)
        }
    }

    async function signIn(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        })

        if (error) throw error

        const IMMUTABLE_SUPER_ADMIN_EMAIL = 'geovanepanini@agencyflow.com'

        // 1. IMMUTABLE CHECK
        if (email === IMMUTABLE_SUPER_ADMIN_EMAIL) {
            return { ...data, role: 'super_admin' }
        }

        // Fetch role immediately to allow redirect logic
        const { data: prof, error: profError } = await supabase
            .from('profissionais')
            .select('role')
            .eq('id', data.user.id)
            .single()

        if (profError) console.error('Error fetching role during login:', profError)

        // Track activity on login
        await supabase
            .from('profissionais')
            .update({ last_activity_at: new Date().toISOString() })
            .eq('id', data.user.id)

        // 2. SECURITY DOWNGRADE
        let safeRole = prof?.role
        if (safeRole === 'super_admin') {
            safeRole = 'admin' // Force downgrade
        }

        return { ...data, role: safeRole }
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
