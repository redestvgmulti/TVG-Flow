import { createContext, useContext, useState, useCallback, useRef } from 'react'

const InAppNotificationContext = createContext({})

let notificationIdCounter = 0

export function InAppNotificationProvider({ children }) {
    const [notifications, setNotifications] = useState([])
    const timeoutsRef = useRef(new Map())
    const shownIdsRef = useRef(new Set()) // Track shown notification IDs for deduplication

    const showNotification = useCallback((notification) => {
        const id = `in-app-${Date.now()}-${notificationIdCounter++}`

        // DEDUPLICATION: Check if this notification was already shown
        if (notification.notification_id && shownIdsRef.current.has(notification.notification_id)) {
            return null
        }

        // Detect mobile for longer duration (6.5s vs 5s)
        const isMobile = window.matchMedia('(max-width: 768px)').matches
        const defaultDuration = isMobile ? 6500 : 5000

        const newNotification = {
            id,
            notification_id: notification.notification_id, // Store for deduplication
            title: notification.title || 'Notificação',
            message: notification.message || '',
            type: notification.type || 'info', // info, success, warning, error
            icon: notification.icon,
            onClick: notification.onClick,
            duration: notification.duration || defaultDuration,
            timestamp: Date.now()
        }

        // Mark as shown (for deduplication with push)
        if (notification.notification_id) {
            shownIdsRef.current.add(notification.notification_id)
        }

        // Add notification
        setNotifications(prev => {
            // Limit to 3 simultaneous notifications
            const updated = [newNotification, ...prev].slice(0, 3)
            return updated
        })

        // Auto-dismiss after duration
        if (newNotification.duration > 0) {
            const timeout = setTimeout(() => {
                dismissNotification(id)
            }, newNotification.duration)

            timeoutsRef.current.set(id, timeout)
        }

        return id
    }, [])

    const dismissNotification = useCallback((id) => {
        // Clear timeout if exists
        const timeout = timeoutsRef.current.get(id)
        if (timeout) {
            clearTimeout(timeout)
            timeoutsRef.current.delete(id)
        }

        // Mark as exiting (for animation)
        setNotifications(prev =>
            prev.map(n => n.id === id ? { ...n, exiting: true } : n)
        )

        // Remove after animation completes
        setTimeout(() => {
            setNotifications(prev => prev.filter(n => n.id !== id))
        }, 300) // Match animation duration
    }, [])

    const dismissAll = useCallback(() => {
        // Clear all timeouts
        timeoutsRef.current.forEach(timeout => clearTimeout(timeout))
        timeoutsRef.current.clear()

        // Mark all as exiting
        setNotifications(prev => prev.map(n => ({ ...n, exiting: true })))

        // Remove all after animation
        setTimeout(() => {
            setNotifications([])
        }, 300)
    }, [])

    const value = {
        notifications,
        showNotification,
        dismissNotification,
        dismissAll
    }

    return (
        <InAppNotificationContext.Provider value={value}>
            {children}
        </InAppNotificationContext.Provider>
    )
}

export const useInAppNotification = () => {
    const context = useContext(InAppNotificationContext)
    if (!context) {
        throw new Error('useInAppNotification must be used within InAppNotificationProvider')
    }
    return context
}
