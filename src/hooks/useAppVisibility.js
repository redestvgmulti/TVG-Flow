import { useState, useEffect } from 'react'

/**
 * Hook to detect if the app is currently visible to the user
 * Tracks document visibility state and window focus
 * 
 * @returns {boolean} isAppVisible - true if app is visible and focused
 */
export function useAppVisibility() {
    const [isAppVisible, setIsAppVisible] = useState(
        !document.hidden && document.hasFocus()
    )

    useEffect(() => {
        const handleVisibilityChange = () => {
            setIsAppVisible(!document.hidden && document.hasFocus())
        }

        const handleFocus = () => {
            setIsAppVisible(!document.hidden && document.hasFocus())
        }

        const handleBlur = () => {
            setIsAppVisible(false)
        }

        // Listen to visibility changes
        document.addEventListener('visibilitychange', handleVisibilityChange)
        window.addEventListener('focus', handleFocus)
        window.addEventListener('blur', handleBlur)

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            window.removeEventListener('focus', handleFocus)
            window.removeEventListener('blur', handleBlur)
        }
    }, [])

    return isAppVisible
}
