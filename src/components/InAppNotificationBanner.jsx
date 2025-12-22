import { createPortal } from 'react-dom'
import { useInAppNotification } from '../contexts/InAppNotificationContext'
import { X, Bell, CheckCircle2, AlertTriangle, AlertCircle, ClipboardList } from 'lucide-react'
import '../styles/inAppNotifications.css'

export default function InAppNotificationBanner() {
    const { notifications, dismissNotification } = useInAppNotification()

    const getIcon = (notification) => {
        // Custom icon if provided
        if (notification.icon) {
            return notification.icon
        }

        // Default icons based on type
        switch (notification.type) {
            case 'success':
                return <CheckCircle2 />
            case 'warning':
                return <AlertTriangle />
            case 'error':
                return <AlertCircle />
            case 'task_assigned':
            case 'task_updated':
                return <ClipboardList />
            default:
                return <Bell />
        }
    }

    const handleClick = (notification) => {
        if (notification.onClick) {
            notification.onClick()
        }
        dismissNotification(notification.id)
    }

    const handleClose = (e, notificationId) => {
        e.stopPropagation()
        dismissNotification(notificationId)
    }

    if (notifications.length === 0) {
        return null
    }

    return createPortal(
        <div className="in-app-notifications-container">
            {notifications.map(notification => (
                <div
                    key={notification.id}
                    className={`in-app-notification type-${notification.type} ${notification.exiting ? 'exiting' : 'entering'
                        }`}
                    onClick={() => handleClick(notification)}
                    role="alert"
                    aria-live="polite"
                >
                    <div className="in-app-notification-content">
                        <div className="in-app-notification-icon">
                            {getIcon(notification)}
                        </div>

                        <div className="in-app-notification-body">
                            <p className="in-app-notification-title">
                                {notification.title}
                            </p>
                            {notification.message && (
                                <p className="in-app-notification-message">
                                    {notification.message}
                                </p>
                            )}
                        </div>

                        <button
                            className="in-app-notification-close"
                            onClick={(e) => handleClose(e, notification.id)}
                            aria-label="Fechar notificação"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {notification.duration > 0 && (
                        <div className="in-app-notification-progress">
                            <div className="in-app-notification-progress-bar" />
                        </div>
                    )}
                </div>
            ))}
        </div>,
        document.body
    )
}
