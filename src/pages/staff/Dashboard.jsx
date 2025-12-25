import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useRefresh } from '../../contexts/RefreshContext'
import {
    Clock,
    CheckCircle2,
    Calendar,
    ArrowRight,
    TrendingUp,
    AlertTriangle,
    ListTodo,
    Activity,
    ChevronRight,
    AlertCircle
} from 'lucide-react'
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip, CartesianGrid } from 'recharts'
import '../../styles/staff-dashboard.css'
import '../../styles/staff-tasks.css'


function StaffDashboard() {
    const navigate = useNavigate()
    const { professionalName, professionalId } = useAuth()
    const { registerRefresh, unregisterRefresh } = useRefresh()
    const [stats, setStats] = useState({
        pending: 0,
        completed: 0,
        overdue: 0,
        productivity: 0
    })
    const [recentTasks, setRecentTasks] = useState([])
    const [productivityData, setProductivityData] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchDashboardData()

        registerRefresh(async () => {
            await fetchDashboardData(true)
        })

        return () => unregisterRefresh()
    }, [])

    async function fetchDashboardData(silent = false) {
        try {
            if (!silent) setLoading(true)

            if (!professionalId) {
                setLoading(false)
                return
            }

            // Fetch tasks assigned to this professional
            const { data: tasks, error } = await supabase
                .from('tarefas')
                .select('id, titulo, deadline, status, prioridade, created_at, concluida_at, drive_link')
                .eq('assigned_to', professionalId)
                .order('deadline', { ascending: true, nullsFirst: false })

            if (error) throw error

            const now = new Date()

            // Calculate Stats
            const pendingTasks = tasks.filter(t => t.status === 'pendente' || t.status === 'em_progresso')
            const completedTasks = tasks.filter(t => t.status === 'concluida')

            // Overdue check
            const overdueTasks = pendingTasks.filter(t => {
                if (!t.deadline) return false
                return new Date(t.deadline) < now
            })

            // Productivity (Last 7 days)
            const sevenDaysAgo = new Date()
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
            const recentCompletions = completedTasks.filter(t => new Date(t.concluida_at || t.created_at) > sevenDaysAgo)

            // Prepare Chart Data (Last 7 Days)
            const chartData = []
            for (let i = 6; i >= 0; i--) {
                const date = new Date()
                date.setDate(date.getDate() - i)
                const dateString = date.toLocaleDateString('pt-BR', { weekday: 'short' }) // Seg, Ter...

                const count = recentCompletions.filter(t => {
                    const taskDate = new Date(t.concluida_at || t.created_at)
                    return taskDate.getDate() === date.getDate() && taskDate.getMonth() === date.getMonth()
                }).length

                chartData.push({ name: dateString, value: count })
            }

            setStats({
                pending: pendingTasks.length,
                completed: completedTasks.length,
                overdue: overdueTasks.length,
                productivity: recentCompletions.length
            })

            setProductivityData(chartData)

            // Top listing: pending tasks first, ordered by deadline (already from DB usually, but ensuring)
            // Limit to 5
            setRecentTasks(pendingTasks.slice(0, 5))

        } catch (error) {
            console.error('Error fetching dashboard data:', error)
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="dashboard-container">
                <div className="card loading-card">
                    <p className="loading-text-primary">Carregando painel...</p>
                </div>
            </div>
        )
    }

    const firstName = professionalName?.split(' ')[0] || 'Colaborador'

    return (
        <div className="dashboard-container staff-dashboard-container">
            {/* Header */}
            <div className="dashboard-header">
                <h2>Olá, {firstName}.</h2>
                <p className="text-secondary">Aqui está o panorama das suas atividades.</p>
            </div>

            {/* Metrics Grid */}
            <div className="dashboard-grid-metrics">
                <div className="card metric-card">
                    <h3 className="metric-label">Em Aberto</h3>
                    <p className="metric-value metric-value-primary">{stats.pending}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-secondary">
                        <Clock size={14} />
                        <span>Aguardando ação</span>
                    </div>
                </div>

                <div className="card metric-card">
                    <h3 className="metric-label">Atrasadas</h3>
                    <p className="metric-value text-danger">{stats.overdue}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-danger">
                        <AlertTriangle size={14} />
                        <span>Atenção necessária</span>
                    </div>
                </div>

                <div className="card metric-card">
                    <h3 className="metric-label">Concluídas</h3>
                    <p className="metric-value metric-value-success">{stats.completed}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-secondary">
                        <CheckCircle2 size={14} className="text-success" />
                        <span>Total histórico</span>
                    </div>
                </div>

                <div className="card metric-card">
                    <h3 className="metric-label">Produtividade (7d)</h3>
                    <p className="metric-value">{stats.productivity}</p>
                    <div className="flex items-center gap-2 mt-2 text-xs text-secondary">
                        <TrendingUp size={14} />
                        <span>Tarefas finalizadas</span>
                    </div>
                </div>
            </div>

            <div className="dashboard-grid-charts">
                {/* Chart - Productivity */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title flex items-center gap-2">
                            <Activity size={18} />
                            Desempenho Semanal
                        </h3>
                    </div>
                    <div style={{ width: '100%', height: 200 }}>
                        <ResponsiveContainer>
                            <BarChart data={productivityData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                                <XAxis
                                    dataKey="name"
                                    tick={{ fontSize: 11, fill: '#64748b' }}
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
                                <Bar dataKey="value" fill="var(--color-primary)" radius={[4, 4, 0, 0]} barSize={32} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Recent Tasks List */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title flex items-center gap-2">
                            <ListTodo size={18} />
                            Próximas Tarefas
                        </h3>
                        <button
                            onClick={() => navigate('/staff/tasks')}
                            className="btn btn-ghost btn-sm"
                        >
                            Ver todas
                        </button>
                    </div>

                    {recentTasks.length === 0 ? (
                        <div className="staff-empty-state">
                            <CheckCircle2 size={48} className="text-success opacity-20 mb-4" />
                            <p className="font-medium text-secondary">Tudo em dia!</p>
                            <p className="text-sm text-tertiary">Você não tem tarefas pendentes.</p>
                        </div>
                    ) : (
                        <div className="staff-tasks-list">
                            {recentTasks.map(task => {
                                const isOverdue = new Date(task.deadline) < new Date() && task.status !== 'concluida'
                                const statusClass = task.status === 'concluida' ? 'status-completed' : task.status === 'em_progresso' ? 'status-in-progress' : 'status-pending'
                                const statusText = task.status === 'concluida' ? 'Concluída' : task.status === 'em_progresso' ? 'Em Andamento' : 'Pendente'

                                return (
                                    <div
                                        key={task.id}
                                        className={`staff-task-card ${isOverdue ? 'overdue' : ''}`}
                                        onClick={() => navigate('/staff/tasks')}
                                    >
                                        <div className="staff-task-content">
                                            <div className="staff-task-header">
                                                <span className={`staff-task-status-dot ${statusClass}`}></span>
                                                <span className="staff-task-status-text">{statusText}</span>
                                                {isOverdue && (
                                                    <span className="staff-task-badge-overdue">
                                                        <AlertCircle size={10} />
                                                        Atrasada
                                                    </span>
                                                )}
                                            </div>

                                            <h3 className="staff-task-title">
                                                {task.titulo}
                                            </h3>

                                            <div className="staff-task-meta">
                                                {task.deadline && (
                                                    <div className="staff-task-meta-item">
                                                        <Calendar size={12} />
                                                        <span>{new Date(task.deadline).toLocaleDateString('pt-BR')}</span>
                                                    </div>
                                                )}
                                                {task.prioridade === 'urgente' && (
                                                    <span className="staff-task-priority-urgent">Urgente</span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="staff-task-action">
                                            <ChevronRight size={20} />
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}


export default StaffDashboard
