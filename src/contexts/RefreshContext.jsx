import { createContext, useContext, useState, useCallback, useRef } from 'react'

const RefreshContext = createContext({})

export function RefreshProvider({ children }) {
    const [isRefreshing, setIsRefreshing] = useState(false)
    const refreshFnRef = useRef(null)

    const registerRefresh = useCallback((fn) => {
        refreshFnRef.current = fn
    }, [])

    const unregisterRefresh = useCallback(() => {
        refreshFnRef.current = null
    }, [])

    const triggerRefresh = useCallback(async () => {
        if (isRefreshing) return
        if (!refreshFnRef.current) return

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

    return (
        <RefreshContext.Provider value={{
            isRefreshing,
            registerRefresh,
            unregisterRefresh,
            triggerRefresh
        }}>
            {children}
        </RefreshContext.Provider>
    )
}

export const useRefresh = () => useContext(RefreshContext)
