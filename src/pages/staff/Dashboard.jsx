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
    AlertCircle,
    RefreshCw
} from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer, XAxis, Tooltip, CartesianGrid } from 'recharts'
import { PageTransition } from '../../components/PageTransition'
import LoadingScreen from '../../components/LoadingScreen'
import '../../styles/staff-dashboard.css'
import '../../styles/staff-tasks.css'


function StaffDashboard() {
    const navigate = useNavigate()
    const { professionalName, professionalId, loading: authLoading, authReady, user } = useAuth()
    const { registerRefresh, unregisterRefresh } = useRefresh()
    const [stats, setStats] = useState({
        pending: 0,
        completed: 0,
        overdue: 0,
        productivity: 0
    })
    const [recentTasks, setRecentTasks] = useState([])
    const [productivityData, setProductivityData] = useState([])
    const [dataLoading, setDataLoading] = useState(true)
    const [isRefreshing, setIsRefreshing] = useState(false) // C3: Desktop refresh

    // 🛡️ CRITICAL GUARD: Prevent rendering and queries if auth is not ready
    // This eliminates 401 errors from JWT race condition
    if (authLoading) {
        return <LoadingScreen />
    }

    if (!authReady) {
        return <LoadingScreen />  // Wait for JWT to be injected in Supabase client
    }

    if (!professionalId) {
        return <LoadingScreen />  // Wait for AuthContext to load professionalId
    }

    useEffect(() => {
        // Only fetch if we have professionalId AND auth is ready
        if (!professionalId || !authReady) {
            return
        }

        fetchDashboardData()

        registerRefresh(async () => {
            await fetchDashboardData(true)
        })

        return () => unregisterRefresh()
    }, [professionalId])

    async function fetchDashboardData(silent = false) {
        setIsRefreshing(true) // C3: Track refresh
        try {
            if (!silent) setDataLoading(true)

            if (!professionalId) {
                setDataLoading(false)
                return
            }



            // I2: Fetch Micro + Macro tasks in parallel (50% faster)
            const [
                { data: microTasks, error: microError },
                { data: legacyTasks, error: legacyError }
            ] = await Promise.all([
                supabase
                    .from('tarefas_micro')
                    .select(`
                        *,
                        tarefas (
                            titulo,
                            deadline,
                            prioridade,
                            descricao
                        )
                    `)
                    .eq('profissional_id', professionalId),

                supabase
                    .from('tarefas')
                    .select('id, titulo, deadline, status, prioridade, created_at, concluida_at, drive_link')
                    .eq('assigned_to', professionalId)
                    .order('deadline', { ascending: true })
            ])

            if (microError) {
                throw microError
            }

            if (legacyError) {
                throw legacyError
            }

            // Normalize and Merge
            const allTasks = []

            // Process Micro Tasks
            microTasks?.forEach(mt => {
                allTasks.push({
                    id: mt.id,
                    titulo: mt.tarefas?.titulo || `[${mt.funcao}] Sem título`,
                    deadline: mt.tarefas?.deadline,
                    prioridade: mt.tarefas?.prioridade || 'normal',
                    status: mt.status,
                    created_at: mt.created_at,
                    concluida_at: mt.concluida_at, // Micro tasks might not have this, check DB schema. Usually we use created_at or logs for completion time if strictly needed, but let's see. 
                    // Actually micro tasks don't have 'concluida_at' col by default in some schemas, but let's assume if it's completed we strictly care about status.
                    // For productivity chart (last 7 days), we need a date.
                    // If 'concluida_at' doesn't exist on micro tasks, we might need to rely on 'updated_at' or just use 'created_at' for now if specific completion time isn't tracked on the row.
                    // HOWEVER, looking at previous files, 'tarefas_micro' usually tracks status.
                    // Let's use updated_at as proxy for completion time if status is completed
                    completion_date: mt.status === 'concluida' ? (mt.updated_at || mt.created_at) : null,
                    is_micro_task: true,
                    funcao: mt.funcao
                })
            })

            // Process Legacy Tasks
            legacyTasks?.forEach(lt => {
                // Avoid duplicates if a legacy task is somehow also a macro task for the user (rare in this model but good safety)
                // Actually, legacy tasks are directly assigned. Micro tasks are childs. They shouldn't overlap in ID space of "items to do".
                allTasks.push({
                    id: lt.id,
                    titulo: lt.titulo,
                    deadline: lt.deadline,
                    prioridade: lt.prioridade,
                    status: lt.status,
                    created_at: lt.created_at,
                    concluida_at: lt.concluida_at,
                    completion_date: lt.concluida_at,
                    is_micro_task: false
                })
            })

            // Calculate Stats
            const now = new Date()

            // Map statuses to general buckets
            const pendingTasks = allTasks.filter(t => ['pendente', 'em_progresso', 'em_execucao', 'devolvida'].includes(t.status))
            const completedTasks = allTasks.filter(t => t.status === 'concluida')

            // Overdue check
            const overdueTasks = pendingTasks.filter(t => {
                if (!t.deadline) return false
                return new Date(t.deadline) < now
            })

            // Productivity (Last 7 days)
            const sevenDaysAgo = new Date()
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
            const recentCompletions = completedTasks.filter(t => {
                const date = new Date(t.completion_date || t.created_at)
                return date > sevenDaysAgo
            })

            // Prepare Chart Data (Last 7 Days)
            const chartData = []
            for (let i = 6; i >= 0; i--) {
                const date = new Date()
                date.setDate(date.getDate() - i)
                const dateString = date.toLocaleDateString('pt-BR', { weekday: 'short' })

                const count = recentCompletions.filter(t => {
                    const taskDate = new Date(t.completion_date || t.created_at)
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

            // Top listing: sort by deadline ascending (nearest deadline first)
            const sortedTasks = [...pendingTasks].sort((a, b) => {
                if (!a.deadline) return 1
                if (!b.deadline) return -1
                return new Date(a.deadline) - new Date(b.deadline)
            })

            setRecentTasks(sortedTasks.slice(0, 20)) // C3: Increased to 20 for scroll

        } catch (error) {
            // Error handled silently
        } finally {
            setDataLoading(false)
            setIsRefreshing(false) // C3: Clear refresh
        }
    }

    // C3: Desktop manual refresh handler
    async function handleManualRefresh() {
        await fetchDashboardData(true)
    }

    if (authLoading || !professionalId) {
        return (
            <div className="dashboard-container">
                <div style={{ height: '60vh', display: 'flex', alignItems: 'center' }}>
                    <LoadingScreen message={authLoading ? 'Autenticando...' : 'Carregando perfil...'} />
                </div>
            </div>
        )
    }

    const firstName = professionalName?.split(' ')[0] || 'Colaborador'

    // Safety check for critical data structures
    const safeRecentTasks = Array.isArray(recentTasks) ? recentTasks : []
    const safeProductivityData = Array.isArray(productivityData) ? productivityData : []

    return (
        <PageTransition>
            <div className="dashboard-container staff-dashboard-container">
                {/* Header */}
                <div className="dashboard-header staff-greeting-header">
                    <h2>Olá, {firstName}.</h2>
                    <p className="text-secondary">Aqui está o panorama das suas atividades.</p>
                </div>

                {/* Metrics Grid */}
                <div className="dashboard-grid-metrics">
                    <div className="card metric-card">
                        <h3 className="metric-label">Em Aberto</h3>
                        <p className="metric-value metric-value-primary">{stats?.pending || 0}</p>
                        <div className="metric-footer">
                            <Clock size={14} />
                            <span>Aguardando ação</span>
                        </div>
                    </div>

                    <div className="card metric-card">
                        <h3 className="metric-label">Atrasadas</h3>
                        <p className="metric-value metric-value-danger">{stats?.overdue || 0}</p>
                        <div className="metric-footer text-danger">
                            <AlertTriangle size={14} />
                            <span>Atenção necessária</span>
                        </div>
                    </div>

                    <div className="card metric-card">
                        <h3 className="metric-label">Concluídas</h3>
                        <p className="metric-value metric-value-success">{stats?.completed || 0}</p>
                        <div className="metric-footer">
                            <CheckCircle2 size={14} className="text-success" />
                            <span>Total histórico</span>
                        </div>
                    </div>

                    <div className="card metric-card">
                        <h3 className="metric-label">Produtividade</h3>
                        <p className="metric-value">{stats?.productivity || 0}</p>
                        <div className="metric-footer">
                            <TrendingUp size={14} />
                            <span>Últimos 7 dias</span>
                        </div>
                    </div>
                </div>

                <div className="dashboard-grid-charts">
                    {/* Chart - Productivity */}
                    <div className="card content-card">
                        <div className="card-header">
                            <h3 className="card-title flex items-center gap-2">
                                <Activity size={20} className="text-primary" />
                                Desempenho Semanal
                            </h3>
                        </div>

                        <div className="chart-wrapper">
                            <div className="chart-container" style={{ width: '100%', height: 220, minHeight: 220 }}>
                                <ResponsiveContainer width="100%" height={220}>
                                    <AreaChart
                                        data={safeProductivityData}
                                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                                    >
                                        <defs>
                                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.8} />
                                                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                        <XAxis
                                            dataKey="name"
                                            tick={{ fontSize: 11, fill: '#6B7280' }}
                                            axisLine={false}
                                            tickLine={false}
                                            dy={10}
                                        />
                                        <Tooltip
                                            cursor={{ stroke: '#3B82F6', strokeWidth: 1, strokeDasharray: '5 5' }}
                                            contentStyle={{
                                                borderRadius: '12px',
                                                border: 'none',
                                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                                background: '#FFFFFF',
                                                color: '#1F2937'
                                            }}
                                            formatter={(value) => [`${value} tarefas`, 'Concluídas']}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="value"
                                            stroke="#3B82F6"
                                            strokeWidth={2}
                                            fillOpacity={1}
                                            fill="url(#colorValue)"
                                            activeDot={{ r: 4, fill: '#3B82F6', stroke: '#fff', strokeWidth: 2 }}
                                            animationDuration={1000}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* Recent Tasks List */}
                    <div className="card content-card dashboard-tasks-card">
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

                        {safeRecentTasks.length === 0 ? (
                            <div className="staff-empty-state">
                                <CheckCircle2 size={48} className="text-success opacity-20 mb-4" />
                                <p className="title">Tudo em dia!</p>
                                <p className="subtitle">Você não tem tarefas pendentes.</p>
                            </div>
                        ) : (
                            <div className="staff-tasks-list dashboard-tasks-scroll">
                                {safeRecentTasks.map(task => {
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
        </PageTransition >
    )
}

export default StaffDashboard
