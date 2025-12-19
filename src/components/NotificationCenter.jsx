import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Bell, ClipboardList, CheckCircle2, Trash2, Check, X } from 'lucide-react'

function NotificationCenter() {
    const { professionalId } = useAuth()
    const [notifications, setNotifications] = useState([])
    const [unreadCount, setUnreadCount] = useState(0)
    const [showPanel, setShowPanel] = useState(false)
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        if (professionalId) {
            fetchNotifications()

            // Subscribe to real-time notifications
            const channel = supabase
                .channel('notifications')
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `profissional_id=eq.${professionalId}`
                }, handleNewNotification)
                .subscribe()

            return () => {
                supabase.removeChannel(channel)
            }
        }
    }, [professionalId])

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
        setNotifications(prev => [payload.new, ...prev])
        setUnreadCount(prev => prev + 1)
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
        if (!confirm('Limpar todas as notificações? Esta ação não pode ser desfeita.')) return

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
        </div>
    )
}

export default NotificationCenter
