import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { useAuth } from '../contexts/AuthContext'

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
                return '📋'
            case 'task_completed':
                return '✅'
            default:
                return '🔔'
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
            {/* Notification Bell */}
            <button
                onClick={() => setShowPanel(!showPanel)}
                style={{
                    position: 'relative',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 'var(--text-xl)',
                    padding: 'var(--space-xs)',
                    color: 'var(--color-text-primary)'
                }}
            >
                🔔
                {unreadCount > 0 && (
                    <span
                        className="badge badge-danger"
                        style={{
                            position: 'absolute',
                            top: '0',
                            right: '0',
                            minWidth: '18px',
                            height: '18px',
                            borderRadius: '9px',
                            fontSize: '10px',
                            padding: '2px 4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                )}
            </button>

            {/* Notification Panel */}
            {showPanel && (
                <>
                    <div
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            zIndex: 999
                        }}
                        onClick={() => setShowPanel(false)}
                    />
                    <div
                        className="card"
                        style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            marginTop: 'var(--space-xs)',
                            width: '360px',
                            maxWidth: '90vw',
                            maxHeight: '500px',
                            zIndex: 1000,
                            padding: 0,
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div style={{
                            padding: 'var(--space-md)',
                            borderBottom: '1px solid var(--color-border-light)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <h3 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Notificações</h3>
                            {notifications.length > 0 && (
                                <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                                    {unreadCount > 0 && (
                                        <button
                                            onClick={markAllAsRead}
                                            className="btn btn-secondary"
                                            style={{ padding: 'var(--space-xs) var(--space-sm)', fontSize: 'var(--text-sm)' }}
                                        >
                                            Marcar todas como lidas
                                        </button>
                                    )}
                                    <button
                                        onClick={clearAll}
                                        className="btn btn-secondary"
                                        style={{ padding: 'var(--space-xs) var(--space-sm)', fontSize: 'var(--text-sm)' }}
                                    >
                                        Limpar todas
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Notifications List */}
                        <div style={{ overflowY: 'auto', flex: 1 }}>
                            {loading ? (
                                <div style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                    Carregando...
                                </div>
                            ) : notifications.length === 0 ? (
                                <div style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                    <p style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-sm)' }}>🎉</p>
                                    <p style={{ margin: 0 }}>Sem notificações</p>
                                </div>
                            ) : (
                                notifications.map(notification => (
                                    <div
                                        key={notification.id}
                                        style={{
                                            padding: 'var(--space-md)',
                                            borderBottom: '1px solid var(--color-border-light)',
                                            backgroundColor: notification.read_at ? 'transparent' : 'var(--color-bg-subtle)',
                                            cursor: 'pointer'
                                        }}
                                        onClick={() => !notification.read_at && markAsRead(notification.id)}
                                    >
                                        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                            <div style={{ fontSize: 'var(--text-xl)' }}>
                                                {getNotificationIcon(notification.type)}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 'var(--space-xs)' }}>
                                                    <strong style={{ fontSize: 'var(--text-sm)' }}>{notification.title}</strong>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            clearNotification(notification.id)
                                                        }}
                                                        style={{
                                                            background: 'transparent',
                                                            border: 'none',
                                                            cursor: 'pointer',
                                                            padding: '0',
                                                            fontSize: 'var(--text-lg)',
                                                            color: 'var(--color-text-tertiary)'
                                                        }}
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                                    {notification.message}
                                                </p>
                                                <p style={{ margin: 0, marginTop: 'var(--space-xs)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                                                    {formatTimeAgo(notification.created_at)}
                                                </p>
                                            </div>
                                        </div>
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
