import { createPortal } from 'react-dom'
import { useInAppNotification } from '../contexts/InAppNotificationContext'
import { X } from 'lucide-react'
import '../styles/inAppNotifications.css'

export default function InAppNotificationBanner() {
    const { notifications, dismissNotification } = useInAppNotification()

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
        <div className="toast-container">
            {notifications.map(notification => (
                <div
                    key={notification.id}
                    className={`toast-item toast-${notification.type} ${notification.exiting ? 'toast-exiting' : ''}`}
                    onClick={() => handleClick(notification)}
                    role="alert"
                    aria-live="polite"
                >
                    <div className="toast-header">
                        <span className="toast-dot"></span>
                        <span className="toast-title">{notification.title}</span>
                        <button
                            className="toast-close"
                            onClick={(e) => handleClose(e, notification.id)}
                            aria-label="Fechar notificação"
                        >
                            ×
                        </button>
                    </div>
                    {notification.message && (
                        <div className="toast-body">
                            {notification.message}
                        </div>
                    )}
                </div>
            ))}
        </div>,
        document.body
    )
}
