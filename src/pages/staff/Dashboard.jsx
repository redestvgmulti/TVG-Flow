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
    ListTodo
} from 'lucide-react'

function StaffDashboard() {
    const navigate = useNavigate()
    const { professionalName, professionalId } = useAuth()
    const { registerRefresh, unregisterRefresh } = useRefresh()
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

        // Register pull-to-refresh
        registerRefresh(async () => {
            await fetchDashboardData(true) // Silent refresh
        })

        return () => unregisterRefresh()
    }, [])

    async function fetchDashboardData(silent = false) {
        try {
            if (!silent) setLoading(true)

            // CRITICAL SECURITY FIX: Only fetch tasks where the professional has a micro-task assigned
            // First, get all micro-tasks for this professional
            const { data: microTasks, error: microError } = await supabase
                .from('tarefas_itens')
                .select('tarefa_id')
                .eq('profissional_id', professionalId)

            if (microError) throw microError

            // Extract unique task IDs
            const taskIds = [...new Set(microTasks?.map(mt => mt.tarefa_id) || [])]

            if (taskIds.length === 0) {
                // No tasks assigned to this professional
                setStats({
                    pending: 0,
                    completed: 0,
                    overdue: 0,
                    productivity: 0
                })
                setRecentTasks([])
                return
            }

            // Now fetch only those specific tasks
            const { data: tasks, error } = await supabase
                .from('tarefas')
                .select('id, titulo, deadline_at, status, priority, created_at, completed_at')
                .in('id', taskIds)
                .order('deadline_at', { ascending: true, nullsFirst: false })

            if (error) throw error

            const now = new Date()

            // Calculate Stats
            const pendingTasks = tasks.filter(t => t.status === 'pendente' || t.status === 'em_progresso')
            const completedTasks = tasks.filter(t => t.status === 'concluida')

            // Check overdue (only for non-completed tasks)
            const overdueTasks = pendingTasks.filter(t => {
                if (!t.deadline_at) return false
                return new Date(t.deadline_at) < now
            })

            // Very basic "Productivity" metric (last 7 days completions)
            const sevenDaysAgo = new Date()
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
            const recentCompletions = completedTasks.filter(t => new Date(t.completed_at || t.created_at) > sevenDaysAgo).length

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
        </div>
    )
}

export default StaffDashboard
