import { useState, useEffect, useRef } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Custom hook for periodic update checking
 * 
 * Responsibilities:
 * - Initial check after 5 minutes
 * - Periodic check every 6 hours
 * - Online connectivity verification
 * - Integration with Service Worker registration.update()
 * 
 * Returns:
 * - hasUpdate: boolean indicating if new version is available
 * - isCheckingForUpdate: boolean indicating if check is in progress
 * - checkForUpdate: function to manually trigger update check
 */
export function useUpdateCheck() {
    const [isCheckingForUpdate, setIsCheckingForUpdate] = useState(false)
    const hasCheckedInitial = useRef(false)

    const {
        needRefresh: [needRefresh],
        updateServiceWorker
    } = useRegisterSW({
        onRegistered(registration) {
            if (!registration) return

            // Initial check after 5 minutes
            if (!hasCheckedInitial.current) {
                setTimeout(() => {
                    if (navigator.onLine) {
                        console.log('[PWA] Initial update check after 5 minutes')
                        registration.update()
                    }
                    hasCheckedInitial.current = true
                }, 5 * 60 * 1000) // 5 minutes
            }

            // Periodic check every 6 hours
            const PERIODIC_CHECK_INTERVAL = 6 * 60 * 60 * 1000 // 6 hours
            const intervalId = setInterval(() => {
                if (navigator.onLine) {
                    console.log('[PWA] Periodic update check (6h interval)')
                    registration.update()
                }
            }, PERIODIC_CHECK_INTERVAL)

            return () => clearInterval(intervalId)
        },
        onRegisterError(error) {
            console.error('[PWA] SW registration error:', error)
        }
    })

    /**
     * Manual update check
     * Only executes if user is online
     */
    const checkForUpdate = async () => {
        if (!navigator.onLine) {
            console.warn('[PWA] Cannot check for updates: offline')
            return
        }

        setIsCheckingForUpdate(true)

        try {
            const registration = await navigator.serviceWorker.getRegistration()
            if (registration) {
                await registration.update()
            }
        } catch (error) {
            console.error('[PWA] Manual update check failed:', error)
        } finally {
            setIsCheckingForUpdate(false)
        }
    }

    return {
        hasUpdate: needRefresh && navigator.onLine, // Only show update if online
        isCheckingForUpdate,
        checkForUpdate,
        updateServiceWorker
    }
}
