import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import {
    Clock,
    CheckCircle2,
    Calendar,
    ArrowRight,
    TrendingUp,
    AlertTriangle,
    ListTodo
} from 'lucide-react'

function StaffDashboard() {
    const navigate = useNavigate()
    const { professionalName, professionalId } = useAuth()
    const [stats, setStats] = useState({
        pending: 0,
        completed: 0,
        overdue: 0,
        completionRate: 0
    })
    const [recentTasks, setRecentTasks] = useState([])
    const [loading, setLoading] = useState(true)

    const today = new Date().toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
    })

    useEffect(() => {
        fetchDashboardData()
    }, [])

    async function fetchDashboardData() {
        try {
            setLoading(true)

            // RLS will automatically filter tasks for the current user
            // We fetch all tasks to calculate client-side stats quickly
            // For production with massive data, this should be an RPC
            const { data: tasks, error } = await supabase
                .from('tarefas')
                .select('id, titulo, deadline, status, priority, created_at')
                .order('deadline', { ascending: true })

            if (error) throw error

            const now = new Date()

            // Calculate Stats
            const pendingTasks = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress')
            const completedTasks = tasks.filter(t => t.status === 'completed')

            // Check overdue (only for non-completed tasks)
            const overdueTasks = pendingTasks.filter(t => {
                if (!t.deadline) return false
                return new Date(t.deadline) < now
            })

            // Very basic "Productivity" metric (last 7 days completions)
            const sevenDaysAgo = new Date()
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
            const recentCompletions = completedTasks.filter(t => new Date(t.completed_at || t.created_at) > sevenDaysAgo).length // Fallback to created_at if completed_at missing

            setStats({
                pending: pendingTasks.length,
                completed: completedTasks.length,
                overdue: overdueTasks.length,
                productivity: recentCompletions
            })

            // Set Recent/Upcoming Tasks (Top 5 pending)
            setRecentTasks(pendingTasks.slice(0, 5))

        } catch (error) {
            console.error('Error fetching dashboard data:', error)
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )
    }

    const firstName = professionalName?.split(' ')[0] || 'Colaborador'

    return (
        <div className="staff-dashboard animation-fade-in pb-12">
            {/* Header */}
            <header className="mb-10">
                <p className="text-sm text-tertiary uppercase tracking-wide font-semibold mb-1">
                    {today}
                </p>
                <h1 className="text-3xl font-bold text-primary">
                    Olá, {firstName}.
                </h1>
                <p className="text-secondary mt-2 text-lg">
                    Aqui está o panorama das suas atividades.
                </p>
            </header>

            {/* BLOCK 1: Overview Cards (CityOS Silent Style) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                {/* Pending */}
                <div className="card p-6 border-l-4 border-brand hover:translate-y-[-2px] transition-transform duration-300">
                    <div className="flex justify-between items-start mb-4">
                        <span className="text-secondary font-medium">Em Aberto</span>
                        <Clock size={20} className="text-brand opacity-80" />
                    </div>
                    <div className="text-4xl font-bold text-primary mb-1">{stats.pending}</div>
                    <div className="text-xs text-tertiary">Tarefas aguardando ação</div>
                </div>

                {/* Overdue */}
                <div className="card p-6 border-l-4 border-danger hover:translate-y-[-2px] transition-transform duration-300">
                    <div className="flex justify-between items-start mb-4">
                        <span className="text-secondary font-medium">Atrasadas</span>
                        <AlertTriangle size={20} className="text-danger opacity-80" />
                    </div>
                    <div className="text-4xl font-bold text-primary mb-1">{stats.overdue}</div>
                    <div className="text-xs text-tertiary">Precisam de atenção imediata</div>
                </div>

                {/* Completed Total */}
                <div className="card p-6 border-l-4 border-success hover:translate-y-[-2px] transition-transform duration-300">
                    <div className="flex justify-between items-start mb-4">
                        <span className="text-secondary font-medium">Concluídas</span>
                        <CheckCircle2 size={20} className="text-success opacity-80" />
                    </div>
                    <div className="text-4xl font-bold text-primary mb-1">{stats.completed}</div>
                    <div className="text-xs text-tertiary">Total histórico</div>
                </div>

                {/* Productivity (Last 7 Days) */}
                <div className="card p-6 border-l-4 border-purple-500 hover:translate-y-[-2px] transition-transform duration-300">
                    <div className="flex justify-between items-start mb-4">
                        <span className="text-secondary font-medium">Produtividade</span>
                        <TrendingUp size={20} className="text-purple-500 opacity-80" />
                    </div>
                    <div className="text-4xl font-bold text-primary mb-1">{stats.productivity}</div>
                    <div className="text-xs text-tertiary">Concluídas nos últimos 7 dias</div>
                </div>
            </div>

            {/* BLOCK 2: My Tasks (Preview) */}
            <div className="card mb-8 mt-8">
                <div className="card-header flex items-center justify-between">
                    <h3 className="card-title flex items-center gap-2">
                        <ListTodo size={18} />
                        Próximas Tarefas
                    </h3>
                    <button onClick={() => navigate('/staff/tasks')} className="btn btn-ghost btn-sm text-brand text-xs font-semibold !no-underline hover:!no-underline" style={{ textDecoration: 'none' }}>
                        Ver todas
                    </button>
                </div>

                {recentTasks.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon">📝</span>
                        <p className="empty-text">Você não tem tarefas pendentes próximas.</p>
                    </div>
                ) : (
                    <div className="task-list">
                        {recentTasks.map(task => {
                            const isOverdue = task.deadline && new Date(task.deadline) < new Date()

                            return (
                                <div
                                    onClick={() => navigate(`/staff/tasks/${task.id}`)}
                                    key={task.id}
                                    style={{ textDecoration: 'none' }}
                                    className="task-item card hover:border-brand-light/50 transition-colors group bg-white !no-underline hover:!no-underline cursor-pointer"
                                >
                                    <div className="task-item-content">
                                        <h3 className="task-item-title group-hover:text-brand transition-colors flex items-center gap-2">
                                            {task.titulo}
                                            {isOverdue && (
                                                <AlertTriangle size={14} className="text-danger" />
                                            )}
                                        </h3>

                                        <div className="task-item-meta flex items-center gap-3">
                                            {task.deadline && (
                                                <span className={`flex items-center gap-1.5 ${isOverdue ? 'text-danger' : 'text-tertiary'}`}>
                                                    <Calendar size={13} className="opacity-70" />
                                                    <span className="font-medium">{new Date(task.deadline).toLocaleDateString('pt-BR')}</span>
                                                    <span className="opacity-60 hidden xs:inline">
                                                        • {new Date(task.deadline).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="task-item-actions flex-col items-end gap-2">
                                        <span
                                            className="relative overflow-hidden px-3.5 py-1 rounded-full text-[10px] font-semibold border shadow-sm transition-all duration-300"
                                            style={{
                                                backgroundColor: task.status === 'in_progress' ? '#eff6ff' : '#fff7ed',
                                                color: task.status === 'in_progress' ? '#2563eb' : '#c2410c',
                                                borderColor: task.status === 'in_progress' ? '#bfdbfe' : '#fed7aa',
                                                fontSize: '10px',
                                                fontWeight: 600,
                                                padding: '4px 12px',
                                                textTransform: 'none'
                                            }}
                                        >
                                            <span className="relative z-10 flex items-center gap-1.5">
                                                {task.status === 'in_progress' ? <Clock size={11} className="animate-pulse" /> : <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]"></div>}
                                                {task.status === 'in_progress' ? 'Em andamento' : 'Pendente'}
                                            </span>
                                        </span>

                                        <div className="text-brand opacity-0 group-hover:opacity-100 transition-opacity translate-x-[-10px] group-hover:translate-x-0 duration-200">
                                            <ArrowRight size={16} />
                                        </div>
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

export default StaffDashboard
