import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw } from 'lucide-react'
import { useUpdateCheck } from '../hooks/useUpdateCheck'
import LoadingScreen from './LoadingScreen'
import '../styles/update-banner.css'

// Version injected at build time via vite.config.js
const CURRENT_VERSION = __APP_VERSION__
const ACK_KEY = 'tvgflow:last_acknowledged_version'

/**
 * DEFINITIVE UPDATE SYSTEM - FlowOS
 * 
 * UX Premium Rules:
 * - Banner only appears if: (1) update available AND (2) online AND (3) version not acknowledged
 * - Blue institutional color (not green)
 * - Premium copy oriented to value
 * - iOS safe-area compliant
 * - LoadingScreen displayed BEFORE any destructive operation
 * - Hard reload with fallback
 * 
 * Technical Flow:
 * 1. Show LoadingScreen fullscreen
 * 2. Persist acknowledged version
 * 3. Unregister all Service Workers
 * 4. Clear all caches
 * 5. Hard reload: window.location.href = window.location.href
 * 6. Fallback: window.location.reload()
 */
export function UpdateBanner() {
    const { hasUpdate, updateServiceWorker: swUpdate } = useUpdateCheck()
    const [isUpdating, setIsUpdating] = useState(false)
    const [shouldShowBanner, setShouldShowBanner] = useState(false)

    // Determine if banner should be visible
    useEffect(() => {
        const lastAckVersion = localStorage.getItem(ACK_KEY)
        const showBanner = hasUpdate && CURRENT_VERSION !== lastAckVersion
        setShouldShowBanner(showBanner)
    }, [hasUpdate])

    /**
     * Update Handler - CRITICAL FLOW
     * 
     * 1. Display LoadingScreen FIRST (before ANY destructive operation)
     * 2. Persist acknowledged version
     * 3. Unregister Service Workers
     * 4. Clear caches
     * 5. Hard reload
     */
    const handleUpdate = async () => {
        // Step 1: Show LoadingScreen IMMEDIATELY
        setIsUpdating(true)

        // Small delay to ensure LoadingScreen renders before destructive ops
        await new Promise(resolve => setTimeout(resolve, 100))

        try {
            // Step 2: Persist acknowledged version BEFORE reload
            localStorage.setItem(ACK_KEY, CURRENT_VERSION)

            // Step 3: Activate new Service Worker
            await swUpdate(true)

            // Step 4: Unregister ALL Service Workers (hard cleanup)
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations()
                for (const registration of registrations) {
                    await registration.unregister()
                }
            }

            // Step 5: Clear ALL caches
            if ('caches' in window) {
                const cacheNames = await caches.keys()
                await Promise.all(
                    cacheNames.map(cacheName => caches.delete(cacheName))
                )
            }

            // Step 6: Hard reload (forces re-fetch from server)
            // Delay to ensure LoadingScreen is visible
            setTimeout(() => {
                window.location.href = window.location.href
            }, 500)

        } catch (error) {
            console.error('[PWA] Update failed, using fallback reload:', error)

            // Fallback: Simple reload if hard reload fails
            setTimeout(() => {
                window.location.reload()
            }, 500)
        }
    }

    // Don't render if update is not available or already acknowledged
    if (!shouldShowBanner && !isUpdating) return null

    // Display LoadingScreen during update process
    if (isUpdating) {
        return <LoadingScreen message="Preparando a nova versão…" />
    }

    return (
        <AnimatePresence>
            <motion.div
                initial={{ y: -80, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -80, opacity: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="update-banner-container"
            >
                <div className="update-banner-content">
                    <div className="update-banner-icon">
                        <RefreshCw size={18} />
                    </div>
                    <div className="update-banner-text">
                        <div className="update-banner-headline">
                            O FlowOS evoluiu.
                        </div>
                        <div className="update-banner-subtitle">
                            Atualize para receber melhorias de desempenho e estabilidade.
                        </div>
                    </div>
                    <button
                        onClick={handleUpdate}
                        className="update-banner-button"
                    >
                        Atualizar e recarregar
                    </button>
                </div>
            </motion.div>
        </AnimatePresence>
    )
}
