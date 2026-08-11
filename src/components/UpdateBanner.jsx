import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw } from 'lucide-react'
import { useUpdateCheck } from '../hooks/useUpdateCheck'
import LoadingScreen from './LoadingScreen'
import '../styles/update-banner.css'

/**
 * DEFINITIVE UPDATE BANNER - TVG Hub
 * 
 * Depends exclusively on vite-plugin-pwa (useUpdateCheck hook).
 * No more version.json polling or localStorage hacks.
 */
export function UpdateBanner() {
    const { hasUpdate, updateServiceWorker } = useUpdateCheck()
    const [isUpdating, setIsUpdating] = useState(false)

    // Handle the update action
    const handleUpdate = async () => {
        setIsUpdating(true)
        
        // Triggers SW update (skipWaiting)
        // This will trigger 'controllerchange' event in App.jsx
        try {
            updateServiceWorker(true)
        } catch (err) {
            console.error('[PWA] updateServiceWorker failed:', err)
        }

        // Safety Fallback: If no reload happens in 5 seconds, force it.
        // This handles cases where the SW is broken or deadlock occurs.
        setTimeout(() => {
            const fallbackCount = parseInt(sessionStorage.getItem('pwa_fallback_reload_count') || '0')
            
            if (fallbackCount >= 2) {
                console.error('[PWA] Multiple fallback reloads detected. Stopping loop.')
                setIsUpdating(false)
                return
            }

            sessionStorage.setItem('pwa_fallback_reload_count', (fallbackCount + 1).toString())
            window.location.reload()
        }, 5000)
    }

    // If update triggered, show loading
    if (isUpdating) {
        return <LoadingScreen message="Ativando nova versão…" />
    }

    // Show only if PWA detects update and user is online
    if (!hasUpdate) return null

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
                            O TVG Hub evoluiu.
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
