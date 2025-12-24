import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Clock, User, AlertCircle, CheckCircle, ExternalLink, Calendar, Activity, ListTodo } from 'lucide-react'
import TaskForm from '../../components/forms/TaskForm'

function Painel() {
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
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [showReatribuirModal, setShowReatribuirModal] = useState(false)
    const [reassigningTask, setReatribuiringTask] = useState(null)
    const [reassignTo, setReatribuirTo] = useState('')
    const [reassigning, setReatribuiring] = useState(false)
    const [feedback, setFeedback] = useState({ show: false, type: '', message: '' })

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

            setShowReatribuirModal(false)
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
                            <Activity size={18} />
                            Status Atual
                        </h3>
                    </div>
                    {tasksByStatus.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={tasksByStatus}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                                <XAxis
                                    dataKey="name"
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
                                    cursor={{ fill: 'var(--color-bg-subtle)' }}
                                    contentStyle={{
                                        borderRadius: '8px',
                                        border: 'none',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                                    }}
                                />
                                <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={40}>
                                    {tasksByStatus.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="empty-state">
                            <span className="empty-icon">📊</span>
                            <p className="empty-text">Nenhuma tarefa ativa no momento.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Recent Tasks */}
            <div className="card">
                <div className="card-header">
                    <h3 className="card-title flex items-center gap-2">
                        <ListTodo size={18} />
                        Tarefas Recentes
                    </h3>
                    <button onClick={() => setShowCreateModal(true)} className="btn btn-primary">
                        + Nova Tarefa
                    </button>
                </div>

                {recentTasks.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon">📝</span>
                        <p className="empty-text">Você ainda não tem tarefas criadas. Comece agora!</p>
                        <button onClick={() => setShowCreateModal(true)} className="btn btn-primary">
                            Criar Primeira Tarefa
                        </button>
                    </div>
                ) : (
                    <div className="task-list">
                        {recentTasks.map(task => (
                            <div key={task.id} className="task-item card">
                                <div className="task-item-content">
                                    <p className="task-item-title">
                                        {task.titulo}
                                    </p>
                                    <p className="text-sm text-muted task-item-meta">
                                        Prazo: {new Date(task.deadline).toLocaleDateString()} • {getAssignedToName(task.assigned_to)}
                                    </p>
                                </div>

                                <div className="task-item-actions">
                                    <span className={`badge ${getStatusBadgeClass(task.status)}`}>
                                        {task.status}
                                    </span>

                                    <div className="btn-group">
                                        <button
                                            onClick={() => handleOpenReatribuirModal(task)}
                                            className="btn btn-ghost btn-xs"
                                            title="Reatribuir"
                                        >
                                            <User size={16} />
                                        </button>

                                        {task.status !== 'completed' && (
                                            <button
                                                onClick={() => handleCompleteTask(task.id, task.titulo)}
                                                className="btn btn-ghost btn-xs text-success"
                                                title="Concluir"
                                            >
                                                <CheckCircle size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal de Detalhes da Tarefa */}
            {selectedTask && (
                <div className="modal-backdrop" onClick={() => setSelectedTask(null)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Detalhes da Tarefa</h3>
                            <button className="modal-close" onClick={() => setSelectedTask(null)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="detail-group">
                                <label>Título</label>
                                <p className="detail-value">{selectedTask.titulo}</p>
                            </div>

                            <div className="detail-group">
                                <label>Descrição</label>
                                <p className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>
                                    {selectedTask.descricao || 'Sem descrição'}
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="detail-group">
                                    <label>Status</label>
                                    <span className={`badge badge-${selectedTask.status === 'completed' ? 'success' : selectedTask.status === 'in_progress' ? 'primary' : 'neutral'}`}>
                                        {selectedTask.status === 'completed' ? 'Concluída' : selectedTask.status === 'in_progress' ? 'Em Andamento' : 'Pendente'}
                                    </span>
                                </div>

                                <div className="detail-group">
                                    <label>Prioridade</label>
                                    <span className={`badge badge-${selectedTask.prioridade === 'urgent' ? 'danger' : selectedTask.prioridade === 'high' ? 'warning' : 'neutral'}`}>
                                        {selectedTask.prioridade === 'urgent' ? 'Urgente' : selectedTask.prioridade === 'high' ? 'Alta' : 'Normal'}
                                    </span>
                                </div>
                            </div>

                            <div className="detail-group">
                                <label>Responsável</label>
                                <div className="flex items-center gap-2 mt-1">
                                    <div className="avatar-placeholder w-8 h-8 text-xs">
                                        {getAssignedToName(selectedTask.assigned_to)?.charAt(0) || '?'}
                                    </div>
                                    <p className="detail-value mb-0">
                                        {getAssignedToName(selectedTask.assigned_to) || 'Não atribuído'}
                                    </p>
                                </div>
                            </div>

                            {selectedTask.drive_link && (
                                <div className="detail-group">
                                    <label>Link do Drive</label>
                                    <a
                                        href={selectedTask.drive_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary flex items-center gap-2 hover:underline"
                                    >
                                        <ExternalLink size={16} />
                                        Acessar Arquivos
                                    </a>
                                </div>
                            )}

                            <div className="detail-group">
                                <label>Prazos</label>
                                <p className="text-sm text-muted flex items-center gap-2">
                                    <Calendar size={14} />
                                    Criado em: {new Date(selectedTask.created_at).toLocaleDateString()}
                                </p>
                                <p className="text-sm text-muted flex items-center gap-2">
                                    <Clock size={14} />
                                    Vencimento: {new Date(selectedTask.due_date).toLocaleDateString()}
                                </p>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary w-full" onClick={() => setSelectedTask(null)}>
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modals are kept as is, just ensuring classes match */}
            {/* Create Task Modal */}
            {showCreateModal && (
                <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Nova Tarefa</h3>
                            <button className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <TaskForm
                                onSuccess={async () => {
                                    setShowCreateModal(false)
                                    await fetchPainelData()
                                    // Optional: You might want to remove showFeedback here since TaskForm handles its own toasts
                                }}
                                onCancel={() => setShowCreateModal(false)}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Reatribuir Modal */}
            {showReatribuirModal && reassigningTask && (
                <div className="modal-backdrop" onClick={() => setShowReatribuirModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Reatribuir Tarefa</h3>
                            <button className="modal-close" onClick={() => setShowReatribuirModal(false)}>×</button>
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
                                    onClick={() => setShowReatribuirModal(false)}
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
