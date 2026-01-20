import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Bell, ClipboardList, CheckCircle2, Trash2, Check, X, BellRing, Calendar } from 'lucide-react'
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
        // GUARD 1: Never run notification logic on login screen
        if (window.location.pathname === '/login') {
            return
        }

        // GUARD 2: Wait for professionalId before connecting
        if (!professionalId) {
            return
        }

        // Only execute if both guards pass
        fetchNotifications()
        checkPushStatus()

        // Subscribe to real-time notifications from BOTH tables
        // notificacoes = meetings (Portuguese schema)
        // notifications = tasks (English schema)

        const notificacoesChannel = supabase
            .channel(`notificacoes:${professionalId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'notificacoes',
                filter: `profissional_id=eq.${professionalId}`
            }, (payload) => {
                handleNewNotification(payload)
            })
            .subscribe((status, err) => {
                if (err) {
                    console.error('[NotificationCenter] notificacoes subscription error:', err)
                }
                if (status === 'CHANNEL_ERROR') {
                    console.error('[NotificationCenter] ❌ notificacoes channel error')
                }
            })

        const notificationsChannel = supabase
            .channel(`notifications:${professionalId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'notifications',
                filter: `profissional_id=eq.${professionalId}`
            }, (payload) => {
                handleNewTaskNotification(payload)
            })
            .subscribe((status, err) => {
                if (err) {
                    console.error('[NotificationCenter] notifications subscription error:', err)
                }
                if (status === 'CHANNEL_ERROR') {
                    console.error('[NotificationCenter] ❌ notifications channel error')
                }
            })

        return () => {
            supabase.removeChannel(notificacoesChannel)
            supabase.removeChannel(notificationsChannel)
        }
    }, [professionalId])

    async function checkPushStatus() {
        const subscribed = await isPushSubscribed()
        setPushEnabled(subscribed)
    }

    async function handleOptInAccept() {
        setShowOptInPrompt(false)
        setPushLoading(true)
        try {
            const permission = await requestNotificationPermission()
            if (permission === 'granted') {
                await registerServiceWorker()
                const subscription = await subscribeToPush(professionalId)
                if (subscription) {
                    setPushEnabled(true)
                    toast.success('Notificações ativadas!')
                } else {
                    toast.error('Erro ao ativar notificações')
                }
            } else {
                toast.error('Permissão para notificações negada')
            }
        } catch (err) {
            console.error('Opt-in error:', err)
            toast.error('Erro ao ativar notificações')
        } finally {
            setPushLoading(false)
        }
    }

    function handleOptInDecline() {
        setShowOptInPrompt(false)
        sessionStorage.setItem('push-opt-in-declined', 'true')
    }

    async function handleTogglePush() {
        if (pushEnabled) {
            setPushLoading(true)
            try {
                await unsubscribeFromPush()
                setPushEnabled(false)
                toast.success('Notificações push desativadas')
            } catch (error) {
                console.error('Error disabling push:', error)
                toast.error('Erro ao desativar notificações')
            } finally {
                setPushLoading(false)
            }
        } else {
            await handleOptInAccept()
        }
    }

    async function fetchNotifications() {
        try {
            setLoading(true)

            // Fetch from BOTH tables in parallel
            const [notificacoesRes, notificationsRes] = await Promise.all([
                supabase
                    .from('notificacoes')
                    .select('*')
                    .eq('profissional_id', professionalId)
                    .order('created_at', { ascending: false })
                    .limit(50),

                supabase
                    .from('notifications')
                    .select('*')
                    .eq('profissional_id', professionalId)
                    .order('created_at', { ascending: false })
                    .limit(50)
            ])

            if (notificacoesRes.error) throw notificacoesRes.error
            if (notificationsRes.error) throw notificationsRes.error

            // Normalize notifications (English) to notificacoes (Portuguese) schema
            const normalizedTasks = (notificationsRes.data || []).map(n => ({
                id: n.id,
                profissional_id: n.profissional_id,
                tipo: n.type,
                titulo: n.title,
                mensagem: n.message,
                metadata: n.metadata || {},
                lida: n.read_at !== null,
                created_at: n.created_at
            }))

            // Merge both arrays and sort by created_at
            const allNotifications = [...(notificacoesRes.data || []), ...normalizedTasks]
            allNotifications.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

            setNotifications(allNotifications)
            setUnreadCount(allNotifications.filter(n => !n.lida).length)
        } catch (error) {
            console.error('Erro ao buscar notificações:', error)
        } finally {
            setLoading(false)
        }
    }

    function handleNewTaskNotification(payload) {
        // Adapter: Normalize notifications (English) schema to notificacoes (Portuguese)
        const task = payload.new
        const normalized = {
            id: task.id,
            profissional_id: task.profissional_id,
            tipo: task.type,
            titulo: task.title,
            mensagem: task.message,
            metadata: task.metadata || {},
            lida: task.read_at !== null,
            created_at: task.created_at
        }

        // Reuse existing handler with normalized payload
        handleNewNotification({ new: normalized })
    }

    function handleNewNotification(payload) {
        const notification = payload.new

        // DEDUPLICATION: Check if notification already exists
        setNotifications(prev => {
            const exists = prev.some(n => n.id === notification.id)
            if (exists) return prev
            return [notification, ...prev]
        })

        // Update unread count
        setUnreadCount(prev => {
            const alreadyCounted = notifications.some(n => n.id === notification.id)
            return alreadyCounted ? prev : prev + 1
        })

        // Show in-app banner
        showNotification({
            notification_id: notification.id,
            title: notification.titulo,
            message: notification.mensagem,
            type: 'info', // Default type
            icon: getNotificationIcon(notification.tipo),
            onClick: () => {
                if (notification.metadata?.reuniao_id) {
                    // Navigate to calendar or meeting details?
                    // Assuming meetings are in calendar, no specific detail page yet
                    window.location.href = '/staff/calendar'
                }
            }
        })

        // Smart opt-in logic (kept same)
        setInAppNotificationCount(prev => {
            const newCount = prev + 1
            if (newCount === 3 && !pushEnabled && !sessionStorage.getItem('push-opt-in-declined')) {
                setTimeout(() => setShowOptInPrompt(true), 2000)
            }
            return newCount
        })
    }

    async function markAsRead(notificationId) {
        try {
            const { error } = await supabase
                .from('notificacoes')
                .update({ lida: true })
                .eq('id', notificationId)

            if (error) throw error

            setNotifications(prev =>
                prev.map(n => n.id === notificationId ? { ...n, lida: true } : n)
            )
            setUnreadCount(prev => Math.max(0, prev - 1))
        } catch (error) {
            console.error('Erro ao marcar como lida:', error)
        }
    }

    async function clearNotification(notificationId) {
        try {
            // Delete from DB (since we don't have cleared_at)
            const { error } = await supabase
                .from('notificacoes')
                .delete()
                .eq('id', notificationId)

            if (error) throw error

            setNotifications(prev => prev.filter(n => n.id !== notificationId))

            // Update unread count if notification was unread
            const notification = notifications.find(n => n.id === notificationId)
            if (notification && !notification.lida) {
                setUnreadCount(prev => Math.max(0, prev - 1))
            }
        } catch (error) {
            console.error('Erro ao limpar notificação:', error)
        }
    }

    async function markAllAsRead() {
        try {
            // Update all unread for this user
            const { error } = await supabase
                .from('notificacoes')
                .update({ lida: true })
                .eq('profissional_id', professionalId)
                .eq('lida', false)

            if (error) throw error

            setNotifications(prev =>
                prev.map(n => ({ ...n, lida: true }))
            )
            setUnreadCount(0)
            toast.success('Todas as notificações foram marcadas como lidas')
        } catch (error) {
            console.error('Erro ao marcar todas como lidas:', error)
            toast.error('Erro ao atualizar notificações')
        }
    }

    async function clearAll() {
        try {
            // Delete all notifications for this user (or only visible ones?)
            // Safe: Delete all displayed ones
            const ids = notifications.map(n => n.id)
            if (ids.length === 0) return

            const { error } = await supabase
                .from('notificacoes')
                .delete()
                .in('id', ids)

            if (error) throw error

            setNotifications([])
            setUnreadCount(0)
        } catch (error) {
            console.error('Erro ao limpar todas:', error)
        }
    }

    function getNotificationIcon(type) {
        if (!type) return <Bell size={18} />

        if (type.startsWith('meeting_')) {
            return <Calendar size={18} />
        }

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

                                {notifications.length > 0 && (
                                    <>
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
                                    </>
                                )}
                            </div>
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
                                        className={`notification-item ${!notification.lida ? 'unread' : ''}`}
                                        onClick={() => !notification.lida && markAsRead(notification.id)}
                                    >
                                        <div className="notification-icon-wrapper">
                                            {getNotificationIcon(notification.type)}
                                        </div>
                                        <div className="notification-content">
                                            <span className="notification-title">{notification.titulo}</span>
                                            <span className="notification-message">{notification.mensagem}</span>
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
