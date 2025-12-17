import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'

function Today() {
    const { professionalId, professionalName } = useAuth()
    const [tasks, setTasks] = useState([])
    const [loading, setLoading] = useState(true)
    const [feedback, setFeedback] = useState({ show: false, type: '', message: '' })

    useEffect(() => {
        if (professionalId) {
            fetchTodayTasks()
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

    async function fetchTodayTasks() {
        try {
            setLoading(true)

            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const todayStr = today.toISOString()

            const { data, error } = await supabase
                .from('tarefas')
                .select('id, titulo, deadline, status, priority, drive_link')
                .eq('assigned_to', professionalId)
                .or(`deadline.gte.${todayStr},and(deadline.lt.${todayStr},status.neq.completed)`)
                .order('deadline')

            if (error) throw error

            // Sort: overdue first, then by deadline
            const sortedTasks = (data || []).sort((a, b) => {
                const aOverdue = new Date(a.deadline) < today && a.status !== 'completed'
                const bOverdue = new Date(b.deadline) < today && b.status !== 'completed'

                if (aOverdue && !bOverdue) return -1
                if (!aOverdue && bOverdue) return 1

                return new Date(a.deadline) - new Date(b.deadline)
            })

            setTasks(sortedTasks)
        } catch (error) {
            console.error('Error fetching today tasks:', error)
            showFeedback('error', 'Failed to load tasks')
        } finally {
            setLoading(false)
        }
    }

    function showFeedback(type, message) {
        setFeedback({ show: true, type, message })
    }

    function getOverdueDays(deadline) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const deadlineDate = new Date(deadline)
        deadlineDate.setHours(0, 0, 0, 0)

        const diffTime = today - deadlineDate
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))

        return diffDays > 0 ? diffDays : 0
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
            await fetchTodayTasks()
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
            await fetchTodayTasks()
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
                <h2>Today's Tasks</h2>
                <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <p style={{ color: 'var(--color-text-secondary)' }}>Loading your tasks...</p>
                </div>
            </div>
        )
    }

    return (
        <div>
            <h2>Today's Tasks</h2>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-lg)' }}>
                Welcome, {professionalName}! Here are your tasks for today.
            </p>

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

            <div className="card">
                {tasks.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--color-text-secondary)' }}>
                        <p style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-sm)' }}>🎉</p>
                        <p style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-xs)' }}>
                            No tasks scheduled for today
                        </p>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                            Enjoy your day!
                        </p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                        {tasks.map(task => {
                            const overdueDays = getOverdueDays(task.deadline)
                            const isOverdue = overdueDays > 0 && task.status !== 'completed'

                            return (
                                <div
                                    key={task.id}
                                    style={{
                                        padding: 'var(--space-md)',
                                        border: `2px solid ${isOverdue ? '#ff3b30' : 'var(--color-border-light)'}`,
                                        borderRadius: 'var(--radius-md)',
                                        backgroundColor: isOverdue ? '#fff5f5' : 'transparent'
                                    }}
                                >
                                    <div style={{ marginBottom: 'var(--space-sm)' }}>
                                        <h3 style={{ margin: 0, marginBottom: 'var(--space-xs)' }}>
                                            {task.titulo}
                                        </h3>

                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)', alignItems: 'center', marginBottom: 'var(--space-xs)' }}>
                                            <span className={`badge ${getStatusBadgeClass(task.status)}`}>
                                                {task.status}
                                            </span>
                                            {task.priority !== 'low' && task.priority !== 'medium' && (
                                                <span className={`badge ${getPriorityBadgeClass(task.priority)}`}>
                                                    {task.priority}
                                                </span>
                                            )}
                                            {isOverdue && (
                                                <span className="badge badge-danger">
                                                    Overdue by {overdueDays} day{overdueDays > 1 ? 's' : ''}
                                                </span>
                                            )}
                                        </div>

                                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
                                            Deadline: {new Date(task.deadline).toLocaleString()}
                                            {task.drive_link && (
                                                <>
                                                    {' • '}
                                                    <a
                                                        href={task.drive_link}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
                                                    >
                                                        📎 Files
                                                    </a>
                                                </>
                                            )}
                                        </p>
                                    </div>

                                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                                        {task.status !== 'completed' && (
                                            <button
                                                onClick={() => handleCompleteTask(task.id, task.titulo)}
                                                className="btn btn-primary"
                                                style={{ padding: 'var(--space-xs) var(--space-sm)', fontSize: 'var(--text-sm)' }}
                                            >
                                                ✓ Complete
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
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}

export default Today
