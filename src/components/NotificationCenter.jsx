import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Bell, ClipboardList, CheckCircle2, Trash2, Check, X, BellRing } from 'lucide-react'
import { toast } from 'sonner'
import { useInAppNotification } from '../contexts/InAppNotificationContext'
import PushOptInPrompt from './PushOptInPrompt'
import {
    registerServiceWorker,
    requestNotificationPermission,
    subscribeToPush,
    unsubscribeFromPush,
    isPushSubscribed
} from '../services/pushNotifications'

// Helper: Detect iOS PWA (standalone mode)
const isIOSPWA = () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const isStandalone = window.navigator.standalone === true
    return isIOS && isStandalone
}

function NotificationCenter() {
    const { professionalId } = useAuth()
    const { showNotification } = useInAppNotification()
    const [notifications, setNotifications] = useState([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [showPanel, setShowPanel] = useState(false)
    const [loading, setLoading] = useState(false)
    const [pushEnabled, setPushEnabled] = useState(false)
    const [pushLoading, setPushLoading] = useState(false)
    const [showOptInPrompt, setShowOptInPrompt] = useState(false)
    const [inAppNotificationCount, setInAppNotificationCount] = useState(0)
    const [isIOSPWAMode] = useState(isIOSPWA())

    useEffect(() => {
        // Debug logging
        console.log('[NotificationCenter] Mounted', {
            professionalId,
            isIOSPWA: isIOSPWAMode,
            notificationPermission: typeof Notification !== 'undefined' ? Notification.permission : 'N/A'
        })

        if (professionalId) {
            fetchNotifications()
            checkPushStatus()

            // Subscribe to real-time notifications
            const channel = supabase
                .channel('notifications')
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `profissional_id=eq.${professionalId}`
                }, handleNewNotification)
                .subscribe((status) => {
                    console.log('[NotificationCenter] Realtime subscription status:', status)
                })

            return () => {
                console.log('[NotificationCenter] Unmounting, removing channel')
                supabase.removeChannel(channel)
            }
        }
    }, [professionalId])



    async function checkPushStatus() {
        const subscribed = await isPushSubscribed()
        setPushEnabled(subscribed)
    }

    async function handleOptInAccept() {
        // 1. Session Safety Check
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
            toast.error('Sessão expirada. Por favor, faça login novamente.')
            setShowOptInPrompt(false)
            // Optional: Force reload to clear state
            setTimeout(() => window.location.reload(), 1500)
            return
        }

        setPushLoading(true)
        try {
            // Register service worker first
            await registerServiceWorker()

            const permission = await requestNotificationPermission()
            if (permission === 'granted') {
                const subscription = await subscribeToPush(professionalId)

                if (subscription) {
                    setPushEnabled(true)
                    setShowOptInPrompt(false)
                    toast.success('Alertas push ativados!')
                } else {
                    // Subscription failed (likely database error or network)
                    throw new Error('Falha ao salvar inscrição no servidor')
                }
            } else if (permission === 'denied') {
                setShowOptInPrompt(false)
                toast.error('Permissão negada. Ative nas configurações do navegador.')
            } else {
                setShowOptInPrompt(false)
                toast.message('Permissão necessária para ativar alertas.')
            }
        } catch (error) {
            console.error('Error enabling push:', error)
            setShowOptInPrompt(false)

            // Helpful error message for user
            if (error.message.includes('servidor') || error.message.includes('inscrição')) {
                toast.error('Erro de conexão. Tente novamente.')
            } else {
                toast.error('Erro ao ativar alertas push')
            }
        } finally {
            setPushLoading(false)
        }
    }

    function handleOptInDecline() {
        setShowOptInPrompt(false)
        // Store preference to not show again for this session
        sessionStorage.setItem('push-opt-in-declined', 'true')
    }

    async function handleTogglePush() {
        if (pushEnabled) {
            // Disable push
            setPushLoading(true)
            try {
                await unsubscribeFromPush()
                setPushEnabled(false)
                toast.success('Alertas push desativados')
            } catch (error) {
                console.error('Error disabling push:', error)
                toast.error('Erro ao desativar alertas')
            } finally {
                setPushLoading(false)
            }
        } else {
            // Show opt-in prompt
            setShowOptInPrompt(true)
        }
    }

    async function fetchNotifications() {
        try {
            setLoading(true)

            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                .eq('profissional_id', professionalId)
                .is('cleared_at', null)
                .order('created_at', { ascending: false })
                .limit(50)

            if (error) throw error

            setNotifications(data || [])
            setUnreadCount(data?.filter(n => !n.read_at).length || 0)
        } catch (error) {
            console.error('Erro ao buscar notificações:', error)
        } finally {
            setLoading(false)
        }
    }

    function handleNewNotification(payload) {
        const notification = payload.new
        console.log('[NotificationCenter] New notification received:', notification)

        // DEDUPLICATION: Check if notification already exists
        setNotifications(prev => {
            const exists = prev.some(n => n.id === notification.id)
            if (exists) {
                console.log('[NotificationCenter] Duplicate notification ignored:', notification.id)
                return prev // Don't add duplicate
            }

            // Add new notification to the list
            return [notification, ...prev]
        })

        // Update unread count only if it's a new notification
        setUnreadCount(prev => {
            // Check if this notification is already counted
            const alreadyCounted = notifications.some(n => n.id === notification.id)
            return alreadyCounted ? prev : prev + 1
        })

        // Show in-app banner
        console.log('[NotificationCenter] Showing in-app notification')
        showNotification({
            notification_id: notification.id, // CRITICAL: For deduplication with push
            title: notification.title,
            message: notification.message,
            type: notification.type || 'info',
            onClick: () => {
                // Navigate to related entity if available
                if (notification.entity_type === 'task' && notification.entity_id) {
                    window.location.href = `/staff/tasks/${notification.entity_id}`
                }
            }
        })

        // Smart opt-in trigger: after 3 in-app notifications
        setInAppNotificationCount(prev => {
            const newCount = prev + 1
            if (newCount === 3 && !pushEnabled && !sessionStorage.getItem('push-opt-in-declined')) {
                // Show opt-in prompt after a short delay (let user see the notification first)
                setTimeout(() => {
                    setShowOptInPrompt(true)
                }, 2000)
            }
            return newCount
        })
    }

    async function markAsRead(notificationId) {
        try {
            const { error } = await supabase
                .from('notifications')
                .update({ read_at: new Date().toISOString() })
                .eq('id', notificationId)

            if (error) throw error

            setNotifications(prev =>
                prev.map(n => n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n)
            )
            setUnreadCount(prev => Math.max(0, prev - 1))
        } catch (error) {
            console.error('Erro ao marcar como lida:', error)
        }
    }

    async function clearNotification(notificationId) {
        try {
            const { error } = await supabase
                .from('notifications')
                .update({ cleared_at: new Date().toISOString() })
                .eq('id', notificationId)

            if (error) throw error

            setNotifications(prev => prev.filter(n => n.id !== notificationId))

            // Update unread count if notification was unread
            const notification = notifications.find(n => n.id === notificationId)
            if (notification && !notification.read_at) {
                setUnreadCount(prev => Math.max(0, prev - 1))
            }
        } catch (error) {
            console.error('Erro ao limpar notificação:', error)
        }
    }

    async function markAllAsRead() {
        try {
            const unreadIds = notifications.filter(n => !n.read_at).map(n => n.id)

            if (unreadIds.length === 0) return

            const { error } = await supabase
                .from('notifications')
                .update({ read_at: new Date().toISOString() })
                .in('id', unreadIds)

            if (error) throw error

            setNotifications(prev =>
                prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() }))
            )
            setUnreadCount(0)
        } catch (error) {
            console.error('Erro ao marcar todas como lidas:', error)
        }
    }

    async function clearAll() {
        try {
            const ids = notifications.map(n => n.id)

            if (ids.length === 0) return

            const { error } = await supabase
                .from('notifications')
                .update({ cleared_at: new Date().toISOString() })
                .in('id', ids)

            if (error) throw error

            setNotifications([])
            setUnreadCount(0)
        } catch (error) {
            console.error('Erro ao limpar todas:', error)
        }
    }

    function getNotificationIcon(type) {
        switch (type) {
            case 'task_assigned':
            case 'task_updated':
                return <ClipboardList size={18} />
            case 'task_completed':
                return <CheckCircle2 size={18} />
            default:
                return <Bell size={18} />
        }
    }

    function formatTimeAgo(dateString) {
        const date = new Date(dateString)
        const now = new Date()
        const diffMs = now - date
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMs / 3600000)
        const diffDays = Math.floor(diffMs / 86400000)

        if (diffMins < 1) return 'Agora'
        if (diffMins < 60) return `${diffMins}m atrás`
        if (diffHours < 24) return `${diffHours}h atrás`
        if (diffDays < 7) return `${diffDays}d atrás`
        return date.toLocaleDateString()
    }

    return (
        <div style={{ position: 'relative' }}>
            {/* Notification Orb */}
            <button
                className={`notification-orb ${unreadCount > 0 ? 'has-unread' : ''}`}
                onClick={() => setShowPanel(!showPanel)}
                aria-label="Notificações"
            >
                <Bell size={20} />
                {unreadCount > 0 && <span className="orb-pulse" />}
            </button>

            {/* Notification Panel */}
            {showPanel && (
                <>
                    <div
                        className="notification-panel-backdrop"
                        onClick={() => setShowPanel(false)}
                    />
                    <div className="notification-panel">
                        {/* Header */}
                        <div className="notification-header">
                            <h3>Notificações</h3>
                            {notifications.length > 0 && (
                                <div className="notification-actions">
                                    {/* Push Notification Toggle - Hidden on iOS PWA */}
                                    {!isIOSPWAMode && (
                                        <button
                                            onClick={handleTogglePush}
                                            className="btn-text-action"
                                            title={pushEnabled ? 'Desativar notificações push' : 'Ativar notificações push'}
                                            disabled={pushLoading}
                                        >
                                            <BellRing size={16} className={pushEnabled ? 'text-brand' : ''} />
                                            {pushLoading ? '...' : pushEnabled ? 'Push On' : 'Push Off'}
                                        </button>
                                    )}

                                    {unreadCount > 0 && (
                                        <button
                                            onClick={markAllAsRead}
                                            className="btn-text-action"
                                            title="Marcar todas como lidas"
                                        >
                                            <Check size={16} /> Ler todas
                                        </button>
                                    )}
                                    <button
                                        onClick={clearAll}
                                        className="btn-text-action"
                                        title="Limpar tudo"
                                    >
                                        <Trash2 size={16} /> Limpar
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* iOS PWA Limitation Notice */}
                        {isIOSPWAMode && (
                            <div className="notification-ios-notice">
                                <Bell size={16} />
                                <span>
                                    Notificações push não estão disponíveis no iOS.
                                    Você receberá alertas dentro do app enquanto estiver usando.
                                </span>
                            </div>
                        )}

                        {/* Notifications List */}
                        <div className="notification-list">
                            {loading ? (
                                <div className="notification-empty">
                                    Carregando...
                                </div>
                            ) : notifications.length === 0 ? (
                                <div className="notification-empty">
                                    <span className="notification-empty-icon">
                                        <Bell size={48} strokeWidth={1} style={{ opacity: 0.2 }} />
                                    </span>
                                    <p>Tudo limpo por aqui</p>
                                </div>
                            ) : (
                                notifications.map(notification => (
                                    <div
                                        key={notification.id}
                                        className={`notification-item ${!notification.read_at ? 'unread' : ''}`}
                                        onClick={() => !notification.read_at && markAsRead(notification.id)}
                                    >
                                        <div className="notification-icon-wrapper">
                                            {getNotificationIcon(notification.type)}
                                        </div>
                                        <div className="notification-content">
                                            <span className="notification-title">{notification.title}</span>
                                            <span className="notification-message">{notification.message}</span>
                                            <span className="notification-time">{formatTimeAgo(notification.created_at)}</span>
                                        </div>
                                        <button
                                            className="btn-close-notification"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                clearNotification(notification.id)
                                            }}
                                            aria-label="Remover notificação"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* Push Opt-In Prompt */}
            {showOptInPrompt && (
                <PushOptInPrompt
                    onAccept={handleOptInAccept}
                    onDecline={handleOptInDecline}
                    loading={pushLoading}
                />
            )}
        </div>
    )
}

export default NotificationCenter
