import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'

function StaffDashboard() {
    const { professionalId, professionalName } = useAuth()
    const [stats, setStats] = useState({
        totalAssigned: 0,
        pending: 0,
        completed: 0
    })
    const [myTasks, setMyTasks] = useState([])
    const [loading, setLoading] = useState(true)
    const [feedback, setFeedback] = useState({ show: false, type: '', message: '' })

    useEffect(() => {
        if (professionalId) {
            fetchMyTasks()
        }
    }, [professionalId])

    useEffect(() => {
        if (feedback.show) {
            const timer = setTimeout(() => {
                setFeedback({ show: false, type: '', message: '' })
            }, 5000)
            return () => clearTimeout(timer)
        }
    }, [feedback.show])

    async function fetchMyTasks() {
        try {
            setLoading(true)

            const { data: tasks, error } = await supabase
                .from('tarefas')
                .select('id, titulo, deadline, status, priority, created_at')
                .eq('assigned_to', professionalId)
                .order('created_at', { ascending: false })

            if (error) throw error

            const total = tasks?.length || 0
            const pending = tasks?.filter(t => t.status === 'pending' || t.status === 'in_progress').length || 0
            const completed = tasks?.filter(t => t.status === 'completed').length || 0

            setStats({
                totalAssigned: total,
                pending,
                completed
            })

            setMyTasks(tasks || [])
        } catch (error) {
            console.error('Error fetching tasks:', error)
            showFeedback('error', 'Failed to load your tasks')
        } finally {
            setLoading(false)
        }
    }

    function showFeedback(type, message) {
        setFeedback({ show: true, type, message })
    }

    async function handleUpdateStatus(taskId, newStatus, taskTitle) {
        if (!confirm(`Change status of "${taskTitle}" to ${newStatus}?`)) {
            return
        }

        try {
            const { error } = await supabase
                .from('tarefas')
                .update({
                    status: newStatus,
                    completed_at: newStatus === 'completed' ? new Date().toISOString() : null
                })
                .eq('id', taskId)

            if (error) throw error

            showFeedback('success', `Task status updated to ${newStatus}`)
            await fetchMyTasks()
        } catch (error) {
            console.error('Error updating task:', error)
            showFeedback('error', 'Failed to update task status')
        }
    }

    async function handleCompleteTask(taskId, taskTitle) {
        if (!confirm(`Mark "${taskTitle}" as completed?`)) {
            return
        }

        try {
            const { error } = await supabase
                .from('tarefas')
                .update({
                    status: 'completed',
                    completed_at: new Date().toISOString()
                })
                .eq('id', taskId)

            if (error) throw error

            showFeedback('success', 'Task completed!')
            await fetchMyTasks()
        } catch (error) {
            console.error('Error completing task:', error)
            showFeedback('error', 'Failed to complete task')
        }
    }

    function getStatusBadgeClass(status) {
        switch (status) {
            case 'completed':
                return 'badge-success'
            case 'in_progress':
                return 'badge-primary'
            case 'overdue':
                return 'badge-danger'
            default:
                return ''
        }
    }

    function getPriorityBadgeClass(priority) {
        switch (priority) {
            case 'urgent':
                return 'badge-danger'
            case 'high':
                return 'badge-warning'
            default:
                return ''
        }
    }

    if (loading) {
        return (
            <div>
                <h2>My Dashboard</h2>
                <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <p style={{ color: 'var(--color-text-secondary)' }}>Loading your tasks...</p>
                </div>
            </div>
        )
    }

    return (
        <div>
            <h2>Welcome, {professionalName || 'Professional'}!</h2>

            {feedback.show && (
                <div
                    className="card"
                    style={{
                        marginBottom: 'var(--space-md)',
                        padding: 'var(--space-md)',
                        backgroundColor: feedback.type === 'success' ? '#d1f4dd' : '#ffe5e5',
                        border: `1px solid ${feedback.type === 'success' ? '#34c759' : '#ff3b30'}`
                    }}
                >
                    <p style={{
                        margin: 0,
                        color: feedback.type === 'success' ? '#34c759' : '#ff3b30',
                        fontWeight: 'var(--weight-medium)'
                    }}>
                        {feedback.message}
                    </p>
                </div>
            )}

            {/* KPI Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 'var(--space-md)',
                marginBottom: 'var(--space-xl)'
            }}>
                <div className="card">
                    <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Assigned Tasks
                    </h3>
                    <p style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                        {stats.totalAssigned}
                    </p>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Pending
                    </h3>
                    <p style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                        {stats.pending}
                    </p>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Completed
                    </h3>
                    <p style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                        {stats.completed}
                    </p>
                </div>
            </div>

            {/* My Tasks */}
            <div className="card">
                <h3 style={{ marginBottom: 'var(--space-lg)' }}>My Tasks</h3>

                {myTasks.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--color-text-secondary)' }}>
                        <p style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-sm)' }}>No tasks assigned yet</p>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                            Tasks assigned to you will appear here
                        </p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                        {myTasks.map(task => (
                            <div
                                key={task.id}
                                style={{
                                    padding: 'var(--space-md)',
                                    border: '1px solid var(--color-border-light)',
                                    borderRadius: 'var(--radius-md)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    gap: 'var(--space-md)',
                                    flexWrap: 'wrap'
                                }}
                            >
                                <div style={{ flex: 1, minWidth: '200px' }}>
                                    <p style={{ fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-xs)' }}>
                                        {task.titulo}
                                    </p>
                                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
                                        Deadline: {new Date(task.deadline).toLocaleDateString()}
                                    </p>
                                </div>
                                <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span className={`badge ${getStatusBadgeClass(task.status)}`}>
                                        {task.status}
                                    </span>
                                    {task.priority !== 'medium' && task.priority !== 'low' && (
                                        <span className={`badge ${getPriorityBadgeClass(task.priority)}`}>
                                            {task.priority}
                                        </span>
                                    )}
                                    {task.status !== 'completed' && (
                                        <button
                                            onClick={() => handleCompleteTask(task.id, task.titulo)}
                                            className="btn btn-secondary"
                                            style={{ padding: 'var(--space-xs) var(--space-sm)', fontSize: 'var(--text-sm)' }}
                                        >
                                            Complete
                                        </button>
                                    )}
                                    <select
                                        value={task.status}
                                        onChange={(e) => handleUpdateStatus(task.id, e.target.value, task.titulo)}
                                        style={{
                                            padding: 'var(--space-xs) var(--space-sm)',
                                            fontSize: 'var(--text-sm)',
                                            borderRadius: 'var(--radius-sm)',
                                            border: '1px solid var(--color-border)'
                                        }}
                                    >
                                        <option value="pending">Pending</option>
                                        <option value="in_progress">In Progress</option>
                                        <option value="completed">Completed</option>
                                        <option value="overdue">Overdue</option>
                                    </select>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

export default StaffDashboard
