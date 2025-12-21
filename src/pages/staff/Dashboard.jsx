import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import {
    Clock,
    CheckCircle2,
    Calendar,
    ArrowRight,
    TrendingUp,
    AlertTriangle
} from 'lucide-react'

function StaffDashboard() {
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
            <div className="mb-8">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold text-primary">Próximas Tarefas</h2>
                    <Link to="/staff/tasks" className="text-sm font-medium text-brand hover:text-brand-dark flex items-center gap-1 transition-colors">
                        Ver todas
                        <ArrowRight size={16} />
                    </Link>
                </div>

                {recentTasks.length === 0 ? (
                    <div className="card p-12 text-center bg-subtle border-dashed">
                        <CheckCircle2 size={48} className="text-tertiary mx-auto mb-4 opacity-50" />
                        <h3 className="text-lg font-medium text-secondary">Tudo em dia!</h3>
                        <p className="text-tertiary">Você não tem tarefas pendentes próximas.</p>
                    </div>
                ) : (
                    <div className="grid gap-4">
                        {recentTasks.map(task => {
                            const isOverdue = task.deadline && new Date(task.deadline) < new Date()

                            return (
                                <Link
                                    to={`/staff/tasks/${task.id}`}
                                    key={task.id}
                                    className="card p-5 hover:border-brand-light transition-all duration-200 group relative overflow-hidden"
                                >
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-3 mb-1">
                                                <h3 className="font-semibold text-primary group-hover:text-brand transition-colors text-lg">
                                                    {task.titulo}
                                                </h3>
                                                {isOverdue && (
                                                    <span className="badge badge-danger text-[10px] px-2 py-0.5 uppercase tracking-wide">
                                                        Atrasada
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-4 text-sm text-secondary">
                                                {task.deadline && (
                                                    <span className={`flex items-center gap-1.5 ${isOverdue ? 'text-danger' : ''}`}>
                                                        <Calendar size={14} />
                                                        {new Date(task.deadline).toLocaleDateString('pt-BR')}
                                                        <span className="text-tertiary hidden sm:inline">
                                                            às {new Date(task.deadline).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </span>
                                                )}
                                                <span className={`badge ${task.priority === 'urgent' ? 'badge-danger' :
                                                        task.priority === 'high' ? 'badge-warning' : 'badge-neutral'
                                                    } text-[10px]`}>
                                                    {task.priority === 'urgent' ? 'Urgente' :
                                                        task.priority === 'high' ? 'Alta' :
                                                            task.priority === 'medium' ? 'Média' : 'Baixa'}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4">
                                            <div className="hidden md:block">
                                                <span className={`px-3 py-1 rounded-full text-xs font-medium border ${task.status === 'in_progress'
                                                        ? 'bg-blue-50 text-blue-600 border-blue-100'
                                                        : 'bg-gray-50 text-gray-500 border-gray-100'
                                                    }`}>
                                                    {task.status === 'in_progress' ? 'Em andamento' : 'Pendente'}
                                                </span>
                                            </div>
                                            <div className="text-brand opacity-0 group-hover:opacity-100 transition-opacity transform translate-x-[-10px] group-hover:translate-x-0">
                                                <ArrowRight size={20} />
                                            </div>
                                        </div>
                                    </div>
                                </Link>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}

export default StaffDashboard
