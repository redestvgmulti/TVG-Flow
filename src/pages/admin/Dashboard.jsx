import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Clock, User, AlertCircle, CheckCircle, ExternalLink, Calendar, Activity, ListTodo } from 'lucide-react'
import TaskForm from '../../components/forms/TaskForm'
import OperationalFeed from '../../components/dashboard/OperationalFeed'

function Painel() {
    const navigate = useNavigate()
    const [stats, setStats] = useState({
        totalTasks: 0,
        activeTasks: 0,
        completedTasks: 0,
        totalProfissionais: 0
    })
    const [recentTasks, setRecentTasks] = useState([])
    const [tasksOverTime, setTasksOverTime] = useState([])
    const [tasksByStatus, setTasksByStatus] = useState([])
    const [tasksByPriority, setTasksByPriority] = useState([])
    const [professionals, setProfissionais] = useState([])
    const [loading, setLoading] = useState(true)
    const [reassigningTask, setReatribuiringTask] = useState(null)
    const [reassignTo, setReatribuirTo] = useState('')
    const [reassigning, setReatribuiring] = useState(false)
    const [feedback, setFeedback] = useState({ show: false, type: '', message: '' })
    const [selectedTask, setSelectedTask] = useState(null)

    useEffect(() => {
        fetchPainelData()
        fetchProfissionais()
    }, [])

    useEffect(() => {
        if (feedback.show) {
            const timer = setTimeout(() => {
                setFeedback({ show: false, type: '', message: '' })
            }, 5000)
            return () => clearTimeout(timer)
        }
    }, [feedback.show])

    async function fetchProfissionais() {
        try {
            const { data, error } = await supabase
                .from('profissionais')
                .select('id, nome')
                .eq('role', 'profissional')
                .eq('ativo', true)
                .order('nome')

            if (error) throw error
            setProfissionais(data || [])
        } catch (error) {
            console.error('Error fetching professionals:', error)
        }
    }

    async function fetchPainelData() {
        try {
            setLoading(true)

            const { data: allTasks, error: allTasksError } = await supabase
                .from('tarefas_com_status_real')
                .select('id, status, titulo, deadline, priority, created_at, assigned_to, drive_link, is_overdue')
                .order('created_at', { ascending: false })

            if (allTasksError) throw allTasksError

            const { count: profCount, error: profError } = await supabase
                .from('profissionais')
                .select('*', { count: 'exact', head: true })

            if (profError) throw profError

            const total = allTasks?.length || 0
            const active = allTasks?.filter(t => t.status === 'in_progress' || t.status === 'pending').length || 0
            const completed = allTasks?.filter(t => t.status === 'completed').length || 0

            setStats({
                totalTasks: total,
                activeTasks: active,
                completedTasks: completed,
                totalProfissionais: profCount || 0
            })

            setRecentTasks(allTasks?.slice(0, 5) || [])

            const last30Days = getLast30Days()
            const tasksTimeData = last30Days.map(date => {
                const count = allTasks?.filter(t => {
                    const taskDate = new Date(t.created_at).toDateString()
                    return taskDate === date.toDateString()
                }).length || 0
                return {
                    date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    tasks: count
                }
            })
            setTasksOverTime(tasksTimeData)

            const statusData = [
                { name: 'Pending', value: allTasks?.filter(t => t.status === 'pending').length || 0, color: '#6e6e73' },
                { name: 'In Progress', value: allTasks?.filter(t => t.status === 'in_progress').length || 0, color: '#007aff' },
                { name: 'Concluídas', value: allTasks?.filter(t => t.status === 'completed').length || 0, color: '#34c759' },
                { name: 'Overdue', value: allTasks?.filter(t => t.status === 'overdue').length || 0, color: '#ff3b30' }
            ]
            setTasksByStatus(statusData.filter(s => s.value > 0))

            const priorityData = [
                { name: 'Low', value: allTasks?.filter(t => t.priority === 'low').length || 0 },
                { name: 'Medium', value: allTasks?.filter(t => t.priority === 'medium').length || 0 },
                { name: 'High', value: allTasks?.filter(t => t.priority === 'high').length || 0 },
                { name: 'Urgent', value: allTasks?.filter(t => t.priority === 'urgent').length || 0 }
            ]
            setTasksByPriority(priorityData.filter(p => p.value > 0))

        } catch (error) {
            console.error('Error fetching dashboard data:', error)
            showFeedback('error', 'Failed to load dashboard data. Please refresh the page.')
        } finally {
            setLoading(false)
        }
    }

    function showFeedback(type, message) {
        setFeedback({ show: true, type, message })
    }

    function handleOpenReatribuirModal(task) {
        setReatribuiringTask(task)
        setReatribuirTo(task.assigned_to || '')
        // setShowReatribuirModal(true) // This state is removed, so this line should be commented out or removed if it's not used elsewhere.
    }

    async function handleReatribuirTask(e) {
        e.preventDefault()

        if (!confirm(`Reatribuir "${reassigningTask.titulo}" to ${professionals.find(p => p.id === reassignTo)?.nome || 'Não atribuída'}?`)) {
            return
        }

        setReatribuiring(true)

        try {
            const { error } = await supabase
                .from('tarefas')
                .update({ assigned_to: reassignTo || null })
                .eq('id', reassigningTask.id)

            if (error) throw error

            // setShowReatribuirModal(false) // This state is removed
            setReatribuiringTask(null)
            showFeedback('success', 'Task reassigned successfully!')
            await fetchPainelData()
        } catch (error) {
            console.error('Error reassigning task:', error)
            showFeedback('error', 'Failed to reassign task')
        } finally {
            setReatribuiring(false)
        }
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
            await fetchPainelData()
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
            await fetchPainelData()
        } catch (error) {
            console.error('Error completing task:', error)
            showFeedback('error', 'Failed to complete task')
        }
    }

    function getLast30Days() {
        const days = []
        for (let i = 29; i >= 0; i--) {
            const date = new Date()
            date.setDate(date.getDate() - i)
            days.push(date)
        }
        return days
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

    function getAssignedToName(assignedToId) {
        const prof = professionals.find(p => p.id === assignedToId)
        return prof ? prof.nome : 'Não atribuída'
    }

    if (loading) {
        return (
            <div>
                <h2>Painel</h2>
                <div className="card loading-card">
                    <p className="loading-text-primary">
                        Carregando seu painel...
                    </p>
                    <p className="loading-text-secondary">
                        Buscando tarefas, KPIs e gráficos
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="dashboard-container animation-fade-in">
            <div className="dashboard-header">
                <h2>Painel</h2>
            </div>

            {feedback.show && (
                <div className={`card mb-6 p-4 border-${feedback.type === 'success' ? 'success' : 'danger'} bg-${feedback.type === 'success' ? 'success' : 'danger'}-subtle`}>
                    <p className={`text-${feedback.type === 'success' ? 'success' : 'danger'} font-medium m-0`}>
                        {feedback.message}
                    </p>
                </div>
            )}

            {/* KPI Cards */}
            <div className="dashboard-grid-metrics">
                <div className="card metric-card">
                    <h3 className="metric-label">Total de Tarefas</h3>
                    <p className="metric-value">{stats.totalTasks}</p>
                </div>

                <div className="card metric-card">
                    <h3 className="metric-label">Tarefas Ativas</h3>
                    <p className="metric-value metric-value-primary">{stats.activeTasks}</p>
                </div>

                <div className="card metric-card">
                    <h3 className="metric-label">Concluídas</h3>
                    <p className="metric-value metric-value-success">{stats.completedTasks}</p>
                </div>

                <div className="card metric-card">
                    <h3 className="metric-label">Profissionais</h3>
                    <p className="metric-value">{stats.totalProfissionais}</p>
                </div>
            </div>

            {/* Charts Row */}
            <div className="dashboard-grid-charts">
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title">Tarefas (30 dias)</h3>
                    </div>
                    {tasksOverTime.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={tasksOverTime}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 11, fill: '#6B7280' }}
                                    axisLine={false}
                                    tickLine={false}
                                    dy={10}
                                />
                                <YAxis
                                    tick={{ fontSize: 11, fill: '#6B7280' }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: '8px',
                                        border: 'none',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                                    }}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="tasks"
                                    stroke="var(--color-primary)"
                                    strokeWidth={3}
                                    dot={{ fill: 'var(--color-primary)', strokeWidth: 2, r: 4, stroke: '#fff' }}
                                    activeDot={{ r: 6 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="empty-state">
                            <span className="empty-icon">📉</span>
                            <p className="empty-text">Sem dados suficientes para exibir o gráfico.</p>
                        </div>
                    )}
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title flex items-center gap-2">
                            <Activity size={18} className="text-primary" />
                            Feed Operacional
                        </h3>
                    </div>
                    <OperationalFeed />
                </div>
            </div>

            {/* Recent Tasks */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title flex items-center gap-2">
                        <ListTodo size={18} />
                        Tarefas Recentes
                    </h3>
                    <button
                        onClick={() => navigate('/admin/tarefas/nova')}
                        className="btn btn-primary shadow-lg shadow-indigo-500/20"
                    >
                        + Nova Tarefa
                    </button>
                </div>

                {recentTasks.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon">📝</span>
                        <p className="empty-text">Você ainda não tem tarefas criadas. Comece agora!</p>
                        <button onClick={() => navigate('/admin/tarefas/nova')} className="btn btn-primary">
                            Criar Primeira Tarefa
                        </button>
                    </div>
                ) : (
                    <div className="task-list">
                        {recentTasks.map(task => {
                            const isOverdue = task.is_overdue === true && task.status !== 'concluida'

                            return (
                                <div
                                    key={task.id}
                                    className={`task-item card task-card-horizontal ${isOverdue ? 'task-card-overdue task-card-overdue-pulse' : ''}`}
                                >
                                    {/* ESQUERDA — INFORMAÇÕES */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 }}>
                                        <h3 style={{ fontSize: '14px', fontWeight: 600, color: '#0f172a', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {task.titulo}
                                        </h3>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748b' }}>
                                            <svg style={{ width: '14px', height: '14px', color: '#94a3b8', flexShrink: 0 }} viewBox="0 0 24 24" fill="none">
                                                <path
                                                    d="M12 12c2.761 0 5-2.239 5-5S14.761 2 12 2 7 4.239 7 7s2.239 5 5 5Zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5Z"
                                                    fill="currentColor"
                                                />
                                            </svg>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {getAssignedToName(task.assigned_to)}
                                            </span>
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 500 }}>
                                            <span style={{ color: isOverdue ? '#b91c1c' : '#475569', textTransform: 'uppercase', fontSize: '11px', fontWeight: 700, letterSpacing: '0.02em' }}>
                                                {isOverdue ? 'ATRASADA' : task.status}
                                            </span>
                                            <span style={{ color: '#cbd5e1' }}>·</span>
                                            <span style={{ color: isOverdue ? '#dc2626' : '#64748b' }}>
                                                Prazo {new Date(task.deadline).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                            </span>
                                        </div>
                                    </div>

                                    {/* DIREITA — AÇÕES */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '16px' }}>
                                        <button
                                            onClick={() => handleOpenReatribuirModal(task)}
                                            style={{
                                                width: '36px',
                                                height: '36px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                borderRadius: '50%',
                                                border: '1px solid #e2e8f0',
                                                background: 'transparent',
                                                cursor: 'pointer',
                                                transition: 'all 0.2s'
                                            }}
                                            title="Reatribuir"
                                            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                        >
                                            <User size={16} color="#64748b" />
                                        </button>

                                        {task.status !== 'completed' && (
                                            <button
                                                onClick={() => handleCompleteTask(task.id, task.titulo)}
                                                style={{
                                                    width: '36px',
                                                    height: '36px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    borderRadius: '50%',
                                                    border: '1px solid #e2e8f0',
                                                    background: 'transparent',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s'
                                                }}
                                                title="Concluir"
                                                onMouseEnter={e => e.currentTarget.style.background = '#f0fdf4'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <CheckCircle size={16} color="#16a34a" />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Reatribuir Modal */}
            {reassigningTask && (
                <div className="modal-backdrop" onClick={() => setReatribuiringTask(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Reatribuir Tarefa</h3>
                            <button className="modal-close" onClick={() => setReatribuiringTask(null)}>×</button>
                        </div>
                        <form onSubmit={handleReatribuirTask}>
                            <div className="modal-body">
                                <p className="text-muted modal-text-muted">
                                    Tarefa: <strong className="text-primary">{reassigningTask.titulo}</strong>
                                </p>

                                <div className="input-group">
                                    <label htmlFor="reassign_to">Novo Responsável</label>
                                    <select
                                        id="reassign_to"
                                        className="input"
                                        value={reassignTo}
                                        onChange={(e) => setReatribuirTo(e.target.value)}
                                        required
                                    >
                                        <option value="">-- Selecione --</option>
                                        {professionals.map(prof => (
                                            <option key={prof.id} value={prof.id}>{prof.nome}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    onClick={() => setReatribuiringTask(null)}
                                    className="btn btn-secondary"
                                    disabled={reassigning}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={reassigning}
                                >
                                    {reassigning ? 'Salvando...' : 'Confirmar'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Painel
