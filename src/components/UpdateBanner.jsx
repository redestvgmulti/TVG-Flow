import { useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { motion, AnimatePresence } from 'framer-motion'
import '../styles/update-banner.css'

export function UpdateBanner() {
    const { needRefresh, updateServiceWorker } = useRegisterSW()
    const [isUpdating, setIsUpdating] = useState(false)

    const handleUpdate = () => {
        setIsUpdating(true)

        // Delay intencional para UX premium (permite animação de saída)
        setTimeout(() => {
            updateServiceWorker(true)
        }, 350)
    }

    return (
        <AnimatePresence>
            {needRefresh && !isUpdating && (
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
