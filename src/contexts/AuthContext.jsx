import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../services/supabase'

// ROLE ENUM - Prevents typos and ensures consistency
const ROLE = {
    SUPER_ADMIN: 'super_admin',
    ADMIN: 'admin',
    STAFF: 'staff',
    PROFESSIONAL: 'professional'
}

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
    const hasRedirectedRef = useRef(false) // Track if we've already redirected

    // React Router hooks
    const navigate = useNavigate()
    const location = useLocation()

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

                // PHASE 1: SESSION BOOTSTRAP (BLOCKING)
                // We only wait for Supabase to tell us if a session exists.
                const { data: { session }, error } = await supabase.auth.getSession()

                if (!mounted) {
                    return
                }

                if (error) {
                    // Network error or invalid token -> we can't trust the session
                        message: error.message,
                        status: error.status
                    });

                    // If it's an auth error (bad token), clear everything
                    if (error.message?.includes('refresh_token') || error.message?.includes('Invalid') || error.status === 400) {
                        await supabase.auth.signOut({ scope: 'local' }); // Clear local storage only
                    }

                    if (!isNetworkError(error)) {
                        setSession(null)
                        setUser(null)
                        userRef.current = null
                    }
                }

                if (session) {
                        userId: session.user.id,
                        email: session.user.email
                    })
                    setSession(session)
                    setUser(session.user)
                    userRef.current = session.user
                } else {
                    setSession(null)
                    setUser(null)
                    userRef.current = null
                }

            } catch (err) {
            } finally {
                // END OF PHASE 1
                // We MUST unlock the app now. Profile fetching happens next but doesn't block UI.
                if (mounted) {
                    setLoading(false)
                }
            }
        }

        initSession()

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (!mounted) return

                hasSession: !!session,
                userId: session?.user?.id
            })

            if (event === 'TOKEN_REFRESH_FAILED' || event === 'SIGNED_OUT') {

                // Clear corrupted tokens completely
                if (event === 'TOKEN_REFRESH_FAILED') {
                    await supabase.auth.signOut({ scope: 'local' });
                }

                setSession(null)
                setUser(null)
                userRef.current = null
                setRole(null) // Clear role
                setProfessionalId(null)

                // Only forced redirect if strictly needed here, usually ProtectedRoute handles it
                if (window.location.pathname !== '/login' && window.location.pathname !== '/reset-password') {
                    window.location.href = '/login'
                }
                setLoading(false) // Ensure unlocked
                return
            }

            if (session) {
                    userId: session.user.id,
                    event
                })

                // CRITICAL: Reset redirect flag on new sign-in to allow navigation
                if (event === 'SIGNED_IN') {
                    hasRedirectedRef.current = false
                }

                setSession(session)
                setUser(session.user)
                userRef.current = session.user
                // Note: We don't block loading here. UI reacts to 'user' being present.
            }
        })

        return () => {
            mounted = false
            subscription.unsubscribe()
        }
    }, [])

    // PHASE 2: PROFILE HYDRATION (NON-BLOCKING)
    useEffect(() => {
        if (user) {
            // Trigger profile fetch when user is available
            // This runs in parallel with UI rendering
            fetchProfessionalData(user.id, user)
        } else {
            // Clear profile data if no user
            setRole(null)
            setProfessionalId(null)
            setProfessionalName(null)
        }
    }, [user])

    // PHASE 3: CENTRALIZED NAVIGATION (AFTER AUTHENTICATION COMPLETE)
    useEffect(() => {
            loading,
            hasSession: !!session,
            hasUser: !!user,
            role,
            hasRedirectedRef: hasRedirectedRef.current,
            currentPath: location.pathname
        })

        // GUARD 1: Still initializing
        if (loading) {
            return
        }

        // GUARD 2: Not authenticated
        if (!session || !user) {
            hasRedirectedRef.current = false // Reset redirect flag when logged out
            return
        }

        // GUARD 3: Role not yet resolved
        if (!role) {
            return
        }

        // GUARD 4: Already redirected this session
        if (hasRedirectedRef.current) {
            return
        }

        // GUARD 5: Already on a protected route (page refresh case)
        // DO NOT mark hasRedirectedRef here - only when navigate() is actually called
        const currentPath = location.pathname
        const isLoginRoute = currentPath.startsWith('/login') || currentPath === '/'

        if (!isLoginRoute) {
            // CRITICAL: Do NOT set hasRedirectedRef.current = true here
            // User is already where they should be (refresh case)
            return
        }

        // ALL GUARDS PASSED - EXECUTE NAVIGATION
            role,
            currentPath,
            userId: user.id
        })

        let targetRoute = null

        // Route decision based on role enum
        switch (role) {
            case ROLE.SUPER_ADMIN:
                targetRoute = '/platform'
                break
            case ROLE.ADMIN:
                targetRoute = '/admin/dashboard'
                break
            case ROLE.STAFF:
            case ROLE.PROFESSIONAL:
                targetRoute = '/staff/dashboard'
                break
            default:
                // ENTERPRISE FALLBACK: Unknown/invalid role
                // Force logout to prevent user being stuck
                signOut().then(() => {
                    window.location.href = '/login'
                })
                return
        }


        try {
            // RULE: hasRedirectedRef ONLY changes when navigate() is called
            hasRedirectedRef.current = true
            navigate(targetRoute, { replace: true })
        } catch (error) {
            hasRedirectedRef.current = false // Reset on error
            throw error
        }
    }, [loading, session, user, role, location.pathname, navigate])

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
                    // Silent failure - reconnection will retry automatically
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
            return
        }

        isFetchingRef.current = true

        // Safety Timeout removed - relying on natural completion or error

        try {
            // Get current session user email for validation
            let currentUser = userObject
            if (!currentUser) {
                const { data: { user } } = await supabase.auth.getUser()
                currentUser = user
            }

            const userEmail = currentUser?.email

            const IMMUTABLE_SUPER_ADMIN_EMAIL = 'geovanepanini@agencyflow.com'

            // 1. IMMUTABLE SUPER ADMIN CHECK (Overrides DB)
            if (userEmail === IMMUTABLE_SUPER_ADMIN_EMAIL) {
                setRole(ROLE.SUPER_ADMIN)
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

            // 2. FETCH STANDARD DB PROFILE
            const { data: professional, error } = await supabase
                .from('profissionais')
                .select('id, role, nome, ativo')
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

                id: professional.id,
                role: professional.role,
                ativo: professional.ativo
            })

            // SECURITY: Check if user is active
            if (!professional.ativo) {
                setAccountStatus('inactive')
                setRole(null) // Block access
                setLoading(false)
                return
            }

            // 3. ROLE ENFORCEMENT
            let finalRole = professional.role

            // CRITICAL: Prevent anyone else from being super_admin
            if (finalRole === ROLE.SUPER_ADMIN && userEmail !== IMMUTABLE_SUPER_ADMIN_EMAIL) {
                finalRole = ROLE.ADMIN
            }

            // ENTERPRISE: Validate role is from enum (prevent DB corruption issues)
            const validRoles = Object.values(ROLE)
            if (!validRoles.includes(finalRole)) {
                finalRole = ROLE.STAFF
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
                role: finalRole,
                professionalId: professional.id,
                name: professional.nome
            })
            setRole(finalRole)
            setProfessionalId(professional.id || null)
            setProfessionalName(professional.nome || null)
            setAccountStatus('active')
            // Don't touch loading here - it's already FALSE
        } catch (error) {
            setRole(null) // Fail safe
            setProfessionalId(null)
            // Don't touch loading here
        } finally {
            isFetchingRef.current = false
        }
    }

    async function signIn(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        })

        if (error) {
                message: error.message,
                status: error.status
            })
            throw error
        }

            userId: data.user.id,
            email: data.user.email
        })

        const IMMUTABLE_SUPER_ADMIN_EMAIL = 'geovanepanini@agencyflow.com'

        // 1. IMMUTABLE CHECK
        if (email === IMMUTABLE_SUPER_ADMIN_EMAIL) {
            return { ...data, role: ROLE.SUPER_ADMIN }
        }

        // Fetch role immediately to allow redirect logic
        let safeRole = null
        try {
            // DB FETCH WITHOUT TIMEOUT
            // Determine role via standard query
            const { data: prof, error: profError } = await supabase
                .from('profissionais')
                .select('role')
                .eq('id', data.user.id)
                .maybeSingle()

            safeRole = prof?.role
        } catch (err) {
        }

        // Track activity on login - NON-BLOCKING (removed await)
        supabase
            .from('profissionais')
            .update({ last_activity_at: new Date().toISOString() })
            .eq('id', data.user.id)
            .then(({ error }) => {
                // Background update
            })

        // 2. SECURITY DOWNGRADE
        if (safeRole === ROLE.SUPER_ADMIN) {
            safeRole = ROLE.ADMIN // Force downgrade
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
