import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'

function Todia() {
    const { professionalId, professionalName } = useAuth()
    const [tasks, setTasks] = useState([])
    const [loading, setLoading] = useState(true)
    const [feedback, setFeedback] = useState({ show: false, type: '', message: '' })

    useEffect(() => {
        if (professionalId) {
            fetchTodiaTasks()
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

    async function fetchTodiaTasks() {
        try {
            setLoading(true)

            const todia = new Date()
            todia.setHours(0, 0, 0, 0)
            const todiaStr = todia.toISOString()

            const { data, error } = await supabase
                .from('tarefas')
                .select('id, titulo, deadline, status, priority, drive_link')
                .eq('assigned_to', professionalId)
                .or(`deadline.gte.${todiaStr},and(deadline.lt.${todiaStr},status.neq.completed)`)
                .order('deadline')

            if (error) throw error

            // Sort: overdue first, then by deadline
            const sortedTasks = (data || []).sort((a, b) => {
                const aOverdue = new Date(a.deadline) < todia && a.status !== 'completed'
                const bOverdue = new Date(b.deadline) < todia && b.status !== 'completed'

                if (aOverdue && !bOverdue) return -1
                if (!aOverdue && bOverdue) return 1

                return new Date(a.deadline) - new Date(b.deadline)
            })

            setTasks(sortedTasks)
        } catch (error) {
            console.error('Error fetching todia tasks:', error)
            showFeedback('error', 'Failed to load tasks')
        } finally {
            setLoading(false)
        }
    }

    function showFeedback(type, message) {
        setFeedback({ show: true, type, message })
    }

    function getOverdueDays(deadline) {
        const todia = new Date()
        todia.setHours(0, 0, 0, 0)
        const deadlineDate = new Date(deadline)
        deadlineDate.setHours(0, 0, 0, 0)

        const diffTime = todia - deadlineDate
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
            await fetchTodiaTasks()
        } catch (error) {
            console.error('Error updating task:', error)
            showFeedback('error', 'Failed to update task status')
        }
    }

    async function handleConcluirTask(taskId, taskTitle) {
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
            await fetchTodiaTasks()
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
                <h2>Tarefas de Hoje</h2>
                <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <p style={{ color: 'var(--color-text-secondary)' }}>Carregando suas tarefas...</p>
                </div>
            </div>
        )
    }

    return (
        <div>
            <h2>Tarefas de Hoje</h2>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-lg)' }}>
                Bem-vindo, {professionalName}! Aqui estão suas tarefas para hoje.
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
                            Nenhuma tarefa agendada para hoje
                        </p>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                            Aproveite seu dia!
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
                                                    Atrasada há {overdueDays} dia{overdueDays > 1 ? 's' : ''}
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
                                                onClick={() => handleConcluirTask(task.id, task.titulo)}
                                                className="btn btn-primary"
                                                style={{ padding: 'var(--space-xs) var(--space-sm)', fontSize: 'var(--text-sm)' }}
                                            >
                                                ✓ Concluir
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
                                            <option value="completed">Concluird</option>
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

export default Todia
