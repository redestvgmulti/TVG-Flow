import { motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'

export function PageTransition({ children }) {
    const location = useLocation()

    // Debug logging for blank screen investigation
    console.log('[PageTransition] children received:', !!children, location.pathname)

    if (!children) return null

    return (
        <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="w-full h-full"
        >
            {children}
        </motion.div>
    )
}
