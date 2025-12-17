import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

function Dashboard() {
    const [stats, setStats] = useState({
        totalTasks: 0,
        activeTasks: 0,
        completedTasks: 0,
        totalProfessionals: 0
    })
    const [recentTasks, setRecentTasks] = useState([])
    const [tasksOverTime, setTasksOverTime] = useState([])
    const [tasksByStatus, setTasksByStatus] = useState([])
    const [tasksByPriority, setTasksByPriority] = useState([])
    const [loading, setLoading] = useState(true)
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [newTask, setNewTask] = useState({
        titulo: '',
        deadline: '',
        priority: 'medium',
        status: 'pending'
    })
    const [creating, setCreating] = useState(false)

    useEffect(() => {
        fetchDashboardData()
    }, [])

    async function fetchDashboardData() {
        try {
            setLoading(true)

            // Fetch all tasks for charts
            const { data: allTasks, error: allTasksError } = await supabase
                .from('tarefas')
                .select('id, status, titulo, deadline, priority, created_at')
                .order('created_at', { ascending: false })

            if (allTasksError) throw allTasksError

            // Fetch professionals count
            const { count: profCount, error: profError } = await supabase
                .from('profissionais')
                .select('*', { count: 'exact', head: true })

            if (profError) throw profError

            // Calculate stats
            const total = allTasks?.length || 0
            const active = allTasks?.filter(t => t.status === 'in_progress' || t.status === 'pending').length || 0
            const completed = allTasks?.filter(t => t.status === 'completed').length || 0

            setStats({
                totalTasks: total,
                activeTasks: active,
                completedTasks: completed,
                totalProfessionals: profCount || 0
            })

            // Recent tasks (last 5)
            setRecentTasks(allTasks?.slice(0, 5) || [])

            // Tasks over time (last 30 days)
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

            // Tasks by status
            const statusData = [
                { name: 'Pending', value: allTasks?.filter(t => t.status === 'pending').length || 0, color: '#6e6e73' },
                { name: 'In Progress', value: allTasks?.filter(t => t.status === 'in_progress').length || 0, color: '#007aff' },
                { name: 'Completed', value: allTasks?.filter(t => t.status === 'completed').length || 0, color: '#34c759' },
                { name: 'Overdue', value: allTasks?.filter(t => t.status === 'overdue').length || 0, color: '#ff3b30' }
            ]
            setTasksByStatus(statusData.filter(s => s.value > 0))

            // Tasks by priority
            const priorityData = [
                { name: 'Low', value: allTasks?.filter(t => t.priority === 'low').length || 0 },
                { name: 'Medium', value: allTasks?.filter(t => t.priority === 'medium').length || 0 },
                { name: 'High', value: allTasks?.filter(t => t.priority === 'high').length || 0 },
                { name: 'Urgent', value: allTasks?.filter(t => t.priority === 'urgent').length || 0 }
            ]
            setTasksByPriority(priorityData.filter(p => p.value > 0))

        } catch (error) {
            console.error('Error fetching dashboard data:', error)
        } finally {
            setLoading(false)
        }
    }

    async function handleCreateTask(e) {
        e.preventDefault()
        setCreating(true)

        try {
            const { error } = await supabase
                .from('tarefas')
                .insert([{
                    titulo: newTask.titulo,
                    deadline: newTask.deadline,
                    priority: newTask.priority,
                    status: newTask.status
                }])

            if (error) throw error

            // Reset form and close modal
            setNewTask({ titulo: '', deadline: '', priority: 'medium', status: 'pending' })
            setShowCreateModal(false)

            // Refresh dashboard
            await fetchDashboardData()
        } catch (error) {
            console.error('Error creating task:', error)
            alert('Failed to create task')
        } finally {
            setCreating(false)
        }
    }

    async function handleUpdateStatus(taskId, newStatus) {
        try {
            const { error } = await supabase
                .from('tarefas')
                .update({
                    status: newStatus,
                    completed_at: newStatus === 'completed' ? new Date().toISOString() : null
                })
                .eq('id', taskId)

            if (error) throw error

            // Refresh dashboard
            await fetchDashboardData()
        } catch (error) {
            console.error('Error updating task:', error)
            alert('Failed to update task')
        }
    }

    async function handleCompleteTask(taskId) {
        await handleUpdateStatus(taskId, 'completed')
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

    if (loading) {
        return (
            <div>
                <h2>Dashboard</h2>
                <p>Loading...</p>
            </div>
        )
    }

    return (
        <div>
            <h2>Dashboard</h2>

            {/* KPI Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 'var(--space-md)',
                marginBottom: 'var(--space-xl)'
            }}>
                <div className="card">
                    <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)' }}>
                        Total Tasks
                    </h3>
                    <p style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                        {stats.totalTasks}
                    </p>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)' }}>
                        Active Tasks
                    </h3>
                    <p style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                        {stats.activeTasks}
                    </p>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)' }}>
                        Completed
                    </h3>
                    <p style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                        {stats.completedTasks}
                    </p>
                </div>

                <div className="card">
                    <h3 style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-xs)' }}>
                        Professionals
                    </h3>
                    <p style={{ fontSize: 'var(--text-3xl)', fontWeight: 'var(--weight-bold)', margin: 0 }}>
                        {stats.totalProfessionals}
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
                {/* Tasks Over Time */}
                <div className="card">
                    <h3 style={{ marginBottom: 'var(--space-md)' }}>Tasks Over Time (Last 30 Days)</h3>
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
                        <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center' }}>No data available</p>
                    )}
                </div>

                {/* Tasks by Status */}
                <div className="card">
                    <h3 style={{ marginBottom: 'var(--space-md)' }}>Tasks by Status</h3>
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
                        <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center' }}>No data available</p>
                    )}
                </div>
            </div>

            {/* Tasks by Priority */}
            {tasksByPriority.length > 0 && (
                <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
                    <h3 style={{ marginBottom: 'var(--space-md)' }}>Tasks by Priority</h3>
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

            {/* Recent Tasks */}
            <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-md)' }}>
                    <h3 style={{ margin: 0 }}>Recent Tasks</h3>
                    <button onClick={() => setShowCreateModal(true)} className="btn btn-primary">
                        + New Task
                    </button>
                </div>

                {recentTasks.length === 0 ? (
                    <p style={{ color: 'var(--color-text-secondary)' }}>No tasks found</p>
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
                                            onClick={() => handleCompleteTask(task.id)}
                                            className="btn btn-secondary"
                                            style={{ padding: 'var(--space-xs) var(--space-sm)', fontSize: 'var(--text-sm)' }}
                                        >
                                            Complete
                                        </button>
                                    )}
                                    <select
                                        value={task.status}
                                        onChange={(e) => handleUpdateStatus(task.id, e.target.value)}
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
                                    <label htmlFor="titulo">Title</label>
                                    <input
                                        id="titulo"
                                        type="text"
                                        className="input"
                                        value={newTask.titulo}
                                        onChange={(e) => setNewTask({ ...newTask, titulo: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="input-group">
                                    <label htmlFor="deadline">Deadline</label>
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
                                    <label htmlFor="status">Status</label>
                                    <select
                                        id="status"
                                        className="input"
                                        value={newTask.status}
                                        onChange={(e) => setNewTask({ ...newTask, status: e.target.value })}
                                    >
                                        <option value="pending">Pending</option>
                                        <option value="in_progress">In Progress</option>
                                        <option value="completed">Completed</option>
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
        </div>
    )
}

export default Dashboard
