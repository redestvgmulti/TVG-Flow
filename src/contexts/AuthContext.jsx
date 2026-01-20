import { createContext, useContext, useState, useEffect, useRef } from 'react'
import { supabase } from '../services/supabase'
import { normalizeRole } from '../utils/roles'
import { authMonitor, AUTH_EVENTS } from '../utils/authMonitor'

const AuthContext = createContext({})

export { AuthContext } // Export the context

export function useAuth() {
    return useContext(AuthContext)
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null)
    const [session, setSession] = useState(null)
    const [loading, setLoading] = useState(true)
    const [authReady, setAuthReady] = useState(false) // 🛡️ CRITICAL: JWT ready flag
    const [authStatus, setAuthStatus] = useState('booting') // 🔐 NEW: 'booting' | 'authenticated' | 'unauthenticated'
    const [role, setRole] = useState(null)
    const [professionalId, setProfessionalId] = useState(null)
    const [professionalName, setProfessionalName] = useState(null)
    const [accountStatus, setAccountStatus] = useState('active') // 'active' | 'inactive' | 'suspended'
    const [connectionStatus, setConnectionStatus] = useState('online') // 'online' | 'offline' | 'reconnecting'
    const [sessionHealth, setSessionHealth] = useState('healthy') // 'healthy' | 'degraded' | 'expired'


    // Refs to track state without triggering re-renders and prevent race conditions
    const isFetchingRef = useRef(false)
    const userRef = useRef(null)
    const refreshRecoveryTimeoutRef = useRef(null)

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

                if (!mounted) return

                if (error) {
                    console.error('[Auth] Session recovery error:', error)
                    // Session error ignored - SDK handles recovery
                    // ⚠️ NÃO limpar estado - pode ser erro transitório
                }

                if (session) {
                    authMonitor.logEvent(AUTH_EVENTS.SESSION_RECOVERED, { hasSession: true })
                    setSession(session)
                    setUser(session.user)
                    userRef.current = session.user
                    setAuthReady(true)
                    setAuthStatus('authenticated') // 🔐 AUTHENTICATED
                } else {
                    // 🔐 CRITICAL FIX: Boot state ≠ Unauthenticated
                    // Don't clear user during boot - wait for SIGNED_OUT event
                    if (error) {
                        authMonitor.logEvent(AUTH_EVENTS.SESSION_FAILED, { reason: 'transient_error' })
                        setAuthStatus('booting')
                    } else {
                        authMonitor.logEvent(AUTH_EVENTS.BOOT_TO_UNAUTH, { reason: 'no_session_in_storage' })
                        setAuthStatus('unauthenticated')
                        // Only NOW we clear state (no session found in storage)
                        setSession(null)
                        setUser(null)
                        userRef.current = null
                        setAuthReady(false)
                    }
                }

            } catch (err) {
                console.error('[Auth] Exception during session init:', err)
                // 🔐 Exception during boot ≠ Logout
                setAuthStatus('booting')
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

            // CRITICAL: Separate TOKEN_REFRESH_FAILED from SIGNED_OUT
            // TOKEN_REFRESH_FAILED may be transient (network issue) -> grace window
            // SIGNED_OUT is definitive -> immediate cleanup
            if (event === 'TOKEN_REFRESH_FAILED') {
                authMonitor.logEvent(AUTH_EVENTS.TOKEN_REFRESH_FAILED)
                // Token refresh failed - enter grace window
                handleTokenRefreshFailed()
                return
            }

            if (event === 'SIGNED_OUT') {
                authMonitor.logEvent(AUTH_EVENTS.SIGNED_OUT)
                handleSignedOut()
                setAuthReady(false) // Reset auth ready on signout
                setAuthStatus('unauthenticated') // 🔐 UNAUTHENTICATED
                return
            }

            // 🛡️ CRITICAL: Set authReady=true ONLY after JWT is injected
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                authMonitor.logEvent(event === 'SIGNED_IN' ? AUTH_EVENTS.SIGNED_IN : AUTH_EVENTS.TOKEN_REFRESHED)
                setAuthReady(true)
                setAuthStatus('authenticated') // 🔐 AUTHENTICATED
                // ONLY fetch professional data if we have a valid session
                // Don't call on stale/expired sessions or page reload without auth
                if (session?.user?.id && session?.access_token) {
                    fetchProfessionalData(session.user.id, session.user)
                }
            }

            // Handle all auth state updates (SIGNED_IN, INITIAL_SESSION, etc.)
            if (session) {
                setSession(session)
                setUser(session.user)
                userRef.current = session.user
                setSessionHealth('healthy') // Reset health on successful session update
                // Note: We don't block loading here. UI reacts to 'user' being present.
            }
        })

        return () => {
            mounted = false
            subscription.unsubscribe()
        }
    }, [])


    // CRITICAL: Handle TOKEN_REFRESH_FAILED with grace window (30s)
    // This prevents immediate logout on transient network issues
    async function handleTokenRefreshFailed() {
        // Prevent duplicate timeouts
        if (refreshRecoveryTimeoutRef.current) {
            // Recovery already in progress
            return
        }

        console.warn('[Auth] Token refresh failed, entering degraded mode for 30s')
        setSessionHealth('degraded')

        // Grace window: wait 30s and try to recover
        refreshRecoveryTimeoutRef.current = setTimeout(async () => {
            refreshRecoveryTimeoutRef.current = null

            // Attempting session recovery
            const { data: { session }, error } = await supabase.auth.getSession()

            if (session && !error) {
                // Recovery successful
                // Session recovered
                setSessionHealth('healthy')
                setSession(session)
                setUser(session.user)
                userRef.current = session.user
            } else {
                // Definitive failure, clean logout
                console.error('[Auth] ❌ Session recovery failed, logging out')
                handleSignedOut()
            }
        }, 30000)
    }

    // CRITICAL: Handle SIGNED_OUT - the ONLY place where session is definitively cleared
    function handleSignedOut() {

        // Clear any pending recovery timeout
        if (refreshRecoveryTimeoutRef.current) {
            clearTimeout(refreshRecoveryTimeoutRef.current)
            refreshRecoveryTimeoutRef.current = null
        }

        setSessionHealth('expired')
        setSession(null)
        setUser(null)
        userRef.current = null
        setRole(null)
        setProfessionalId(null)
        setProfessionalName(null)

        // Redirect to login if not already there
        if (window.location.pathname !== '/login' && window.location.pathname !== '/reset-password') {
            window.location.href = '/login'
        }

        setLoading(false)
    }

    // 🛡️ REMOVED: This useEffect was causing 401s by triggering fetchProfessionalData
    // immediately when `user` changes, BEFORE JWT is injected into headers.
    // Profile data is now fetched ONLY via onAuthStateChange listener (line ~216)
    // which properly respects the 500ms delay in fetchProfessionalData.
    // DO NOT RE-ADD THIS HOOK - it creates a race condition!

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
                        setAuthReady(true) // 🛡️ CRITICAL: Certifica que JWT está pronto antes de queries
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

        try {
            // 🛡️ CRITICAL GUARD: Prevent queries without valid session
            // This eliminates 401 errors on /login route and ensures clean architecture
            const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession()

            if (!currentSession || !currentSession.user) {
                // 🔐 CRITICAL FIX: Session temporarily unavailable ≠ Logout
                // Don't clear authentication state - just skip professional data fetch
                setLoading(false)
                isFetchingRef.current = false
                return
            }

            // Now safe to proceed - session exists and JWT is present
            const { data: professionalData, error } = await supabase
                .from('profissionais')
                .select(`
          id,
          nome,
          email,
          role,
          ativo,
          departamento:departamentos(id, nome, cor_hex)
        `)
                .eq('id', userId)
                .single()

            if (error) {
                console.error('[Auth] Error fetching professional data:', error)
                throw error
            }

            if (!professionalData) {
                throw new Error('Professional data not found')
            }

            // Update state - this is safe now because session is confirmed
            // Security: Check Super Admin Status via RPC
            const { data: isSuperAdmin } = await supabase.rpc('is_super_admin')

            // Update state - prioritizando a resposta do backend RPC
            setProfessionalId(professionalData.id)
            setProfessionalName(professionalData.nome)

            // Se o backend diz que é super admin, é super admin.
            // Caso contrário, usa o role do banco de dados.
            setRole(isSuperAdmin ? 'super_admin' : professionalData.role)

            setAccountStatus(professionalData.ativo ? 'active' : 'suspended')
            setLoading(false)
        } catch (err) {
            console.error('[Auth] ❌ Error in fetchProfessionalData:', err)
            setRole(null)
            setProfessionalId(null)
            setProfessionalName(null)
            setLoading(false)
        } finally {
            isFetchingRef.current = false
        }
    }

    async function signIn(email, password) {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        })

        if (error) throw error

        // 1. SECURE BACKEND CHECK
        const { data: isSuperAdmin, error: rpcError } = await supabase.rpc('is_super_admin')

        if (!rpcError && isSuperAdmin) {
            return { ...data, role: 'super_admin' }
        }

        // Fetch role immediately to allow redirect logic
        // 🛡️ REMOVED: Immediate role query causes 401 race condition
        // The role will be fetched by fetchProfessionalData via onAuthStateChange listener
        // which fires AFTER JWT is properly injected in the client
        let safeRole = null

        // 🛡️ REMOVED: Background activity tracking via PATCH
        // This was causing 401 errors by executing before JWT was ready
        // Activity tracking is non-critical and can be re-implemented later
        // with proper JWT verification if needed

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
        sessionHealth,
        authReady, // 🛡️ NEW: Indicates JWT is ready in Supabase client
        authStatus, // 🔐 NEW: 'booting' | 'authenticated' | 'unauthenticated'
        signIn,
        signOut
    }

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    )
}
