// Focus Trap Hook - Lightweight implementation for modals
// Ensures keyboard navigation stays within modal

import { useEffect } from 'react'

export function useFocusTrap(isOpen, containerRef) {
    useEffect(() => {
        if (!isOpen || !containerRef.current) return

        const container = containerRef.current
        const focusableElements = container.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        const firstElement = focusableElements[0]
        const lastElement = focusableElements[focusableElements.length - 1]

        // Focus first element when modal opens
        firstElement?.focus()

        const handleTabKey = (e) => {
            if (e.key !== 'Tab') return

            if (e.shiftKey) {
                // Shift + Tab
                if (document.activeElement === firstElement) {
                    e.preventDefault()
                    lastElement?.focus()
                }
            } else {
                // Tab
                if (document.activeElement === lastElement) {
                    e.preventDefault()
                    firstElement?.focus()
                }
            }
        }

        container.addEventListener('keydown', handleTabKey)
        return () => container.removeEventListener('keydown', handleTabKey)
    }, [isOpen, containerRef])
}
