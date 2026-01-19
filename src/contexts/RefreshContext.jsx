import { createContext, useContext, useState, useCallback, useRef } from 'react'

const RefreshContext = createContext({})

export function RefreshProvider({ children }) {
    const [isRefreshing, setIsRefreshing] = useState(false)
    const refreshFnRef = useRef(null)
    const isMutating = useRef(false) // I3: Mutex for mutation + refresh

    const registerRefresh = useCallback((fn) => {
        refreshFnRef.current = fn
    }, [])

    const unregisterRefresh = useCallback(() => {
        refreshFnRef.current = null
    }, [])

    const triggerRefresh = useCallback(async () => {
        if (isRefreshing) return
        if (!refreshFnRef.current) return

        // I3: Block refresh if mutation is active
        if (isMutating.current) {
            console.warn('[RefreshContext] Mutation in progress, skipping refresh')
            return
        }

        try {
            setIsRefreshing(true)
            // Minimum delay to ensure the spinner is seen and UX feels deliberate
            // even if the API is instant
            const minDelay = new Promise(resolve => setTimeout(resolve, 800))

            await Promise.all([
                refreshFnRef.current(),
                minDelay
            ])
        } catch (error) {
            console.error('Refresh failed:', error)
            // Silent error handling as per minimal CityOS design
        } finally {
            setIsRefreshing(false)
        }
    }, [isRefreshing])

    // I3: Expose setMutating for mutation handlers
    const setMutating = useCallback((value) => {
        isMutating.current = value
    }, [])

    return (
        <RefreshContext.Provider value={{
            isRefreshing,
            registerRefresh,
            unregisterRefresh,
            triggerRefresh,
            setMutating // I3: Export mutex control
        }}>
            {children}
        </RefreshContext.Provider>
    )
}

export const useRefresh = () => useContext(RefreshContext)
