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
 * - updateServiceWorker: function to trigger actual PWA update
 */
export function useUpdateCheck() {
    const [isCheckingForUpdate, setIsCheckingForUpdate] = useState(false)
    const [swActive, setSwActive] = useState(true)
    const hasCheckedInitial = useRef(false)
    const registrationRef = useRef(null)

    const {
        needRefresh: [needRefresh], // Correctly destructure boolean from state array
        updateServiceWorker
    } = useRegisterSW({
        onRegistered(registration) {
            if (!registration) return
            registrationRef.current = registration

            // Initial check after 5 minutes
            if (!hasCheckedInitial.current) {
                setTimeout(() => {
                    if (navigator.onLine && registrationRef.current) {
                        registrationRef.current.update().catch(() => {})
                    }
                    hasCheckedInitial.current = true
                }, 5 * 60 * 1000)
            }
        },
        onRegisterError(error) {
            console.error('[PWA] SW registration error:', error)
        }
    })

    // Periodic check and SW health check
    useEffect(() => {
        // 1. Periodic check every 6 hours
        const PERIODIC_CHECK_INTERVAL = 6 * 60 * 60 * 1000
        const intervalId = setInterval(() => {
            if (navigator.onLine && registrationRef.current) {
                registrationRef.current.update().catch(() => {})
            }
        }, PERIODIC_CHECK_INTERVAL)

        // 2. Verify if SW registration is actually working (MIME type check)
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then(reg => {
                if (reg && reg.active) {
                    // Check if the SW script is actually JS
                    fetch(reg.active.scriptURL, { method: 'HEAD' }).then(res => {
                        const contentType = res.headers.get('content-type')
                        if (contentType && contentType.includes('text/html')) {
                            console.warn('[PWA] Service Worker script MIME type error (text/html).')
                            setSwActive(false)
                        } else {
                            setSwActive(true)
                        }
                    }).catch(() => {
                        // If fetch fails (maybe offline), we don't disable SW banner here
                    })
                }
            })
        }

        return () => clearInterval(intervalId)
    }, [])

    /**
     * Manual update check
     */
    const checkForUpdate = async () => {
        if (!navigator.onLine) return
        if (!registrationRef.current) {
            const reg = await navigator.serviceWorker.getRegistration()
            if (reg) registrationRef.current = reg
        }

        if (registrationRef.current) {
            setIsCheckingForUpdate(true)
            try {
                await registrationRef.current.update()
            } catch (error) {
                console.error('[PWA] Manual update check failed:', error)
            } finally {
                setIsCheckingForUpdate(false)
            }
        }
    }

    return {
        hasUpdate: !!(needRefresh && navigator.onLine && swActive),
        isCheckingForUpdate,
        checkForUpdate,
        updateServiceWorker
    }
}
