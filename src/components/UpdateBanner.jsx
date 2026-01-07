import { useState, useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { motion, AnimatePresence } from 'framer-motion'
import '../styles/update-banner.css'

// Version injected at build time via vite.config.js
const CURRENT_VERSION = __APP_VERSION__
const ACK_KEY = 'tvgflow:last_acknowledged_version'

export function UpdateBanner() {
    const { needRefresh, updateServiceWorker } = useRegisterSW()
    const [isUpdating, setIsUpdating] = useState(false)
    const [shouldShowBanner, setShouldShowBanner] = useState(false)

    useEffect(() => {
        // Only show banner if: SW needs refresh AND version differs from last acknowledged
        const lastAckVersion = localStorage.getItem(ACK_KEY)
        const showBanner = needRefresh && CURRENT_VERSION !== lastAckVersion
        setShouldShowBanner(showBanner)
    }, [needRefresh])

    const handleUpdate = () => {
        setIsUpdating(true)

        // Persist acknowledged version BEFORE reload to prevent re-show
        localStorage.setItem(ACK_KEY, CURRENT_VERSION)

        // Delay for UX animation
        setTimeout(() => {
            updateServiceWorker(true)
        }, 350)
    }

    // Early return prevents render entirely (no flicker)
    if (!shouldShowBanner) return null

    return (
        <AnimatePresence>
            {!isUpdating && (
                <motion.div
                    initial={{ y: -60, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -60, opacity: 0 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                    className="update-banner-container"
                >
                    <div className="update-banner-content">
                        <span>🚀 Nova atualização disponível</span>
                        <button
                            onClick={handleUpdate}
                            className="update-banner-button"
                        >
                            Atualizar agora
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
