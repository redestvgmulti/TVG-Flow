import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

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
    const [newTask, setNewTask] = useState({
        titulo: '',
        deadline: '',
        priority: 'medium',
        status: 'pending',
        assigned_to: '',
        drive_link: ''
    })
    const [reassignTo, setReatribuirTo] = useState('')
    const [creating, setCreating] = useState(false)
    const [reassigning, setReatribuiring] = useState(false)
    const [feedback, setFeedback] = useState({ show: false, type: '', message: '' })

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
                .from('tarefas')
                .select('id, status, titulo, deadline, priority, created_at, assigned_to, drive_link')
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
        setShowReatribuirModal(true)
    }

    async function handleCreateTask(e) {
        e.preventDefault()

        if (!newTask.titulo.trim()) {
            showFeedback('error', 'Please enter a task title')
            return
        }

        setCreating(true)

        try {
            const taskData = {
                titulo: newTask.titulo,
                deadline: newTask.deadline,
                priority: newTask.priority,
                status: newTask.status
            }

            // Only add assigned_to if a professional is selected
            if (newTask.assigned_to) {
                taskData.assigned_to = newTask.assigned_to
            }

            // Only add drive_link if provided
            if (newTask.drive_link && newTask.drive_link.trim()) {
                taskData.drive_link = newTask.drive_link.trim()
            }

            const { error } = await supabase
                .from('tarefas')
                .insert([taskData])

            if (error) throw error

            setNewTask({ titulo: '', deadline: '', priority: 'medium', status: 'pending', assigned_to: '', drive_link: '' })
            setShowCreateModal(false)
            showFeedback('success', 'Task created successfully!')
            await fetchPainelData()
        } catch (error) {
            console.error('Error creating task:', error)
            showFeedback('error', 'Failed to create task. Please try again.')
        } finally {
            setCreating(false)
        }
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
                <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-sm)' }}>
                        Carregando seu painel...
                    </p>
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                        Buscando tarefas, KPIs e gráficos
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div>
            <h2>Painel</h2>

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
                        Total de Tarefas
                    </h3>
                    <p style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                        {stats.totalTasks}
                    </p>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Tarefas Ativas
                    </h3>
                    <p style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                        {stats.activeTasks}
                    </p>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Concluídas
                    </h3>
                    <p style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                        {stats.completedTasks}
                    </p>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Profissionais
                    </h3>
                    <p style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                        {stats.totalProfissionais}
                    </p>
                </div>
            </div>

            {/* Charts Row */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: 'var(--space-md)',
                marginBottom: 'var(--space-xl)'
            }}>
                <div className="card">
                    <h3 style={{ marginBottom: 'var(--space-md)' }}>Tarefas ao Longo do Tempo (Últimos 30 Dias)</h3>
                    {tasksOverTime.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={tasksOverTime}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5ea" />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 11, fill: '#6e6e73' }}
                                    interval="preserveStartEnd"
                                />
                                <YAxis tick={{ fontSize: 11, fill: '#6e6e73' }} />
                                <Tooltip />
                                <Line
                                    type="monotone"
                                    dataKey="tasks"
                                    stroke="#007aff"
                                    strokeWidth={2}
                                    dot={{ fill: '#007aff', r: 3 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-text-secondary)' }}>
                            <p style={{ marginBottom: 'var(--space-xs)' }}>Nenhum dado de tarefa ainda</p>
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                                Crie sua primeira tarefa para ver tendências
                            </p>
                        </div>
                    )}
                </div>

                <div className="card">
                    <h3 style={{ marginBottom: 'var(--space-md)' }}>Tarefas por Status</h3>
                    {tasksByStatus.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={tasksByStatus}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5ea" />
                                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6e6e73' }} />
                                <YAxis tick={{ fontSize: 11, fill: '#6e6e73' }} />
                                <Tooltip />
                                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                                    {tasksByStatus.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--color-text-secondary)' }}>
                            <p style={{ marginBottom: 'var(--space-xs)' }}>Nenhum dado de status</p>
                            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                                As tarefas aparecerão aqui conforme você as criar
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {tasksByPriority.length > 0 && (
                <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
                    <h3 style={{ marginBottom: 'var(--space-md)' }}>Tarefas por Prioridade</h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <PieChart>
                            <Pie
                                data={tasksByPriority}
                                cx="50%"
                                cy="50%"
                                labelLine={false}
                                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                outerRadius={80}
                                fill="#8884d8"
                                dataKey="value"
                            >
                                {tasksByPriority.map((entry, index) => {
                                    const colors = ['#6e6e73', '#007aff', '#ff9500', '#ff3b30']
                                    return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                                })}
                            </Pie>
                            <Tooltip />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Tarefas Recentes */}
            <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
                    <h3 style={{ margin: 0 }}>Tarefas Recentes</h3>
                    <button onClick={() => setShowCreateModal(true)} className="btn btn-primary">
                        + Nova Tarefa
                    </button>
                </div>

                {recentTasks.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--color-text-secondary)' }}>
                        <p style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-sm)' }}>Nenhuma tarefa ainda</p>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-md)' }}>
                            Comece criando sua primeira tarefa
                        </p>
                        <button onClick={() => setShowCreateModal(true)} className="btn btn-primary">
                            Criar Primeira Tarefa
                        </button>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                        {recentTasks.map(task => (
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
                                        Prazo: {new Date(task.deadline).toLocaleDateString()} • Atribuída: {getAssignedToName(task.assigned_to)}
                                        {task.drive_link && (
                                            <>
                                                {' • '}
                                                <a
                                                    href={task.drive_link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
                                                >
                                                    📎 Arquivos
                                                </a>
                                            </>
                                        )}
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
                                    <button
                                        onClick={() => handleOpenReatribuirModal(task)}
                                        className="btn btn-secondary"
                                        style={{ padding: 'var(--space-xs) var(--space-sm)', fontSize: 'var(--text-sm)' }}
                                    >
                                        Reatribuir
                                    </button>
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
                                        <option value="completed">Concluídas</option>
                                        <option value="overdue">Overdue</option>
                                    </select>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Create Task Modal */}
            {showCreateModal && (
                <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Create New Task</h3>
                        </div>
                        <form onSubmit={handleCreateTask}>
                            <div className="modal-body">
                                <div className="input-group">
                                    <label htmlFor="titulo">Title *</label>
                                    <input
                                        id="titulo"
                                        type="text"
                                        className="input"
                                        value={newTask.titulo}
                                        onChange={(e) => setNewTask({ ...newTask, titulo: e.target.value })}
                                        placeholder="Enter task title"
                                        required
                                    />
                                </div>

                                <div className="input-group">
                                    <label htmlFor="deadline">Deadline *</label>
                                    <input
                                        id="deadline"
                                        type="datetime-local"
                                        className="input"
                                        value={newTask.deadline}
                                        onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="input-group">
                                    <label htmlFor="assigned_to">Assigned To</label>
                                    <select
                                        id="assigned_to"
                                        className="input"
                                        value={newTask.assigned_to}
                                        onChange={(e) => setNewTask({ ...newTask, assigned_to: e.target.value })}
                                    >
                                        <option value="">Não atribuída</option>
                                        {professionals.map(prof => (
                                            <option key={prof.id} value={prof.id}>{prof.nome}</option>
                                        ))}
                                    </select>
                                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-xs)' }}>
                                        Only active professionals are shown
                                    </p>
                                </div>

                                <div className="input-group">
                                    <label htmlFor="drive_link">Drive / Arquivos Link</label>
                                    <input
                                        id="drive_link"
                                        type="url"
                                        className="input"
                                        value={newTask.drive_link}
                                        onChange={(e) => setNewTask({ ...newTask, drive_link: e.target.value })}
                                        placeholder="https://drive.google.com/..."
                                    />
                                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-xs)' }}>
                                        Optional link to files or documents
                                    </p>
                                </div>

                                <div className="input-group">
                                    <label htmlFor="priority">Priority</label>
                                    <select
                                        id="priority"
                                        className="input"
                                        value={newTask.priority}
                                        onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
                                    >
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                        <option value="urgent">Urgent</option>
                                    </select>
                                </div>

                                <div className="input-group">
                                    <label htmlFor="status">Initial Status</label>
                                    <select
                                        id="status"
                                        className="input"
                                        value={newTask.status}
                                        onChange={(e) => setNewTask({ ...newTask, status: e.target.value })}
                                    >
                                        <option value="pending">Pending</option>
                                        <option value="in_progress">In Progress</option>
                                        <option value="completed">Concluídas</option>
                                    </select>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="btn btn-secondary"
                                    disabled={creating}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={creating}
                                >
                                    {creating ? 'Creating...' : 'Create Task'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Reatribuir Task Modal */}
            {showReatribuirModal && reassigningTask && (
                <div className="modal-backdrop" onClick={() => setShowReatribuirModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Reatribuir Task</h3>
                        </div>
                        <form onSubmit={handleReatribuirTask}>
                            <div className="modal-body">
                                <p style={{ marginBottom: 'var(--space-md)', color: 'var(--color-text-secondary)' }}>
                                    Task: <strong>{reassigningTask.titulo}</strong>
                                </p>

                                <div className="input-group">
                                    <label htmlFor="reassign_to">Assign To</label>
                                    <select
                                        id="reassign_to"
                                        className="input"
                                        value={reassignTo}
                                        onChange={(e) => setReatribuirTo(e.target.value)}
                                        required
                                    >
                                        <option value="">Não atribuída</option>
                                        {professionals.map(prof => (
                                            <option key={prof.id} value={prof.id}>{prof.nome}</option>
                                        ))}
                                    </select>
                                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-xs)' }}>
                                        Only active professionals are shown
                                    </p>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    onClick={() => setShowReatribuirModal(false)}
                                    className="btn btn-secondary"
                                    disabled={reassigning}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={reassigning}
                                >
                                    {reassigning ? 'Reatribuiring...' : 'Reatribuir Task'}
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
