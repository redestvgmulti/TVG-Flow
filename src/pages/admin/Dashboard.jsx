import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { getDashboardMetrics, getRecentTasks } from '../../services/dashboardMetrics'
import CreatorSignature from '../../components/ui/CreatorSignature'
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from 'recharts'
import {
    LayoutDashboard,
    CheckCircle2,
    Clock,
    AlertCircle,
    Activity,
    LogOut,
    Menu,
    X,
    ChevronRight,
    Search,
    Filter,
    MoreVertical,
    Calendar,
    ArrowUpRight,
    ArrowDownRight,
    Users,
    ListTodo,
    ExternalLink,
    User,
    CheckCircle,
    Play,
    Plus,
    ArrowRight,
    RefreshCw
} from 'lucide-react'
import OperationalFeed from '../../components/dashboard/OperationalFeed'
import LoadingScreen from '../../components/LoadingScreen'
import { SkeletonCard } from '../../components/Skeleton'
import { useAuth } from '../../contexts/AuthContext'
import { useRefresh } from '../../contexts/RefreshContext'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import TaskSummaryModal from '../../components/dashboard/TaskSummaryModal'
import EditTaskModal from '../../components/EditTaskModal'
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal'
import { deleteTask } from '../../services/taskService'
import { toast } from 'sonner'
import '../../styles/admin-dashboard.css'
import { AnimatedCounter } from '../../components/ui/AnimatedCounter'

export default function Painel() {
    const navigate = useNavigate()
    const { user, signOut } = useAuth()
    const { setMutating } = useRefresh() // I3: Mutex control
    const [loading, setLoading] = useState(true)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [stats, setStats] = useState({
        totalTasks: 0,
        activeTasks: 0,
        completedTasks: 0,
        overdueTasks: 0
    })
    const [recentTasks, setRecentTasks] = useState([])
    const [selectedTask, setSelectedTask] = useState(null)

    const [chartData, setChartData] = useState([])
    const [chartView, setChartView] = useState('created') // 'created' | 'completed'
    const [tasksByStatus, setTasksByStatus] = useState([])
    const [tasksByPriority, setTasksByPriority] = useState([])
    const [professionals, setProfissionais] = useState([])
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768)

    // Modal states
    const [showReatribuirModal, setShowReatribuirModal] = useState(false)
    const [reassigningTask, setReatribuiringTask] = useState(null)
    const [reassignTo, setReatribuirTo] = useState('')
    const [reassigning, setReatribuiring] = useState(false)

    // Edit/Delete states
    const [showEditModal, setShowEditModal] = useState(false)
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

    useEffect(() => {
        fetchPainelData()
        fetchProfissionais()

        // Handle window resize for mobile detection
        const handleResize = () => {
            setIsMobile(window.innerWidth < 768)
        }
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

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

    async function fetchPainelData(silent = false) {
        try {
            if (!silent) setLoading(true)
            setIsRefreshing(true)


            // 1. Fetch Metrics and Recent Tasks
            const [metrics, tasks] = await Promise.all([
                getDashboardMetrics(),
                getRecentTasks(5)
            ])

            // Populate stats state
            setStats({
                totalTasks: metrics.totalTasks,
                activeTasks: metrics.activeTasks,
                completedTasks: metrics.completedTasks,
                overdueTasks: metrics.overdueTasks
            })

            setRecentTasks(tasks)

            // Fetch aggregated chart data (server-side aggregation - 50x faster)
            const { data: chartDataRaw, error: chartError } = await supabase
                .rpc('get_dashboard_chart_data', { days_back: 30 })

            if (chartError) throw chartError

            // Mobile-specific: Show only last 5 days to prevent horizontal overflow
            const isMobile = window.innerWidth < 768
            const chartDataToDisplay = isMobile
                ? (chartDataRaw || []).slice(-5)
                : (chartDataRaw || [])

            setChartData(chartDataToDisplay)

            // Status and Priority distributions removed - orphaned after RPC refactor
            // Chart data now comes exclusively from get_dashboard_chart_data RPC

        } catch (error) {
            console.error('Error fetching dashboard data:', error)
            toast.error('Não foi possível carregar o painel. Atualize a página.')
        } finally {
            setLoading(false)
            setIsRefreshing(false)
        }
    }

    async function handleManualRefresh() {
        await fetchPainelData(true) // silent = true (sem loading screen)
    }

    // Handlers
    function handleEditTask(task) {
        setShowEditModal(true)
    }

    function handleDeleteTask(task) {
        setShowDeleteModal(true)
    }

    async function confirmDeleteTask() {
        if (!selectedTask) return

        setMutating(true) // I3: Block refresh during delete
        setIsDeleting(true)
        try {
            // Optimistic update: Remove task from UI immediately
            setRecentTasks(prev => prev.filter(t => t.id !== selectedTask.id))

            await deleteTask(selectedTask.id)
            toast.success('Tarefa excluída com sucesso')
            setShowDeleteModal(false)
            setSelectedTask(null) // Closes summary modal too

            // Refresh data to ensure consistency
            fetchPainelData()
        } catch (error) {
            console.error('Error deleting task:', error)
            toast.error('Erro ao excluir tarefa')
            // Rollback: Refresh to restore state
            fetchPainelData()
        } finally {
            setIsDeleting(false)
            setMutating(false) // I3: Unlock refresh
        }
    }

    function onEditSuccess() {
        fetchPainelData()
        // Close summary modal to ensure no stale state
        setSelectedTask(null)
    }

    function handleOpenReatribuirModal(task) {
        setReatribuiringTask(task)
        setReatribuirTo(task.assigned_to || '')
    }

    async function handleReatribuirTask(e) {
        e.preventDefault()
        // O próprio modal já é a confirmação — sem confirm() nativo redundante.
        setReatribuiring(true)

        try {
            const { error } = await supabase
                .from('tarefas')
                .update({ assigned_to: reassignTo || null })
                .eq('id', reassigningTask.id)

            if (error) throw error

            setReatribuiringTask(null)
            toast.success('Tarefa reatribuída com sucesso.')
            await fetchPainelData()
        } catch (error) {
            console.error('Error reassigning task:', error)
            toast.error('Falha ao reatribuir a tarefa.')
        } finally {
            setReatribuiring(false)
        }
    }

    // handlers for status updates...
    async function handleUpdateStatus(taskId, newStatus, taskTitle) {
        try {
            const { error } = await supabase
                .from('tarefas')
                .update({
                    status: newStatus,
                    completed_at: newStatus === 'completed' ? new Date().toISOString() : null
                })
                .eq('id', taskId)

            if (error) throw error

            toast.success('Status da tarefa atualizado.')
            await fetchPainelData()
        } catch (error) {
            console.error('Error updating task:', error)
            toast.error('Falha ao atualizar o status.')
        }
    }

    async function handleCompleteTask(taskId, taskTitle) {
        try {
            const { error } = await supabase
                .from('tarefas')
                .update({
                    status: 'completed',
                    completed_at: new Date().toISOString()
                })
                .eq('id', taskId)

            if (error) throw error

            toast.success('Tarefa concluída!')
            await fetchPainelData()
        } catch (error) {
            console.error('Error completing task:', error)
            toast.error('Falha ao concluir a tarefa.')
        }
    }

    function handleCreateTask() {
        navigate('/admin/tarefas/nova')
    }

    function getStatusColor(status) {
        switch (status) {
            case 'concluida': return 'success'
            case 'atrasada': return 'danger'
            case 'em_execucao': return 'primary'
            case 'pending':
            case 'pendente': return 'warning'
            default: return 'secondary'
        }
    }


    function getAssignedToName(assignedToId) {
        const prof = professionals.find(p => p.id === assignedToId)
        return prof ? prof.nome : 'Não atribuída'
    }

    // Safe Chart Data Logic
    const safeChartData = Array.isArray(chartData)
        ? chartData.filter(d => d?.date && (typeof d?.criadas === 'number' || typeof d?.concluidas === 'number'))
        : []

    // M2: Show skeleton during refresh, not just initial load
    if (loading || isRefreshing) {
        return (
            <div className="dashboard-container animation-fade-in">
                <div className="dashboard-grid-metrics">
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            </div>
        )
    }

    return (
        <div className="dashboard-container animation-fade-in">
            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            {/* BLOCO 1: KPIs PRIMÁRIOS - Torre de Controle      */}
            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div className="dashboard-grid-metrics">
                <div className="card metric-card metric-card-neutral-bg">
                    <h3 className="metric-label">Total de Tarefas</h3>
                    <p className="metric-value">
                        <AnimatedCounter value={stats.totalTasks} />
                    </p>
                    <p className="metric-percentage">Todas as tarefas criadas</p>
                </div>

                <div className="card metric-card metric-card-primary-bg">
                    <h3 className="metric-label">Tarefas Ativas</h3>
                    <p className="metric-value">
                        <AnimatedCounter value={stats.activeTasks} />
                    </p>
                    <p className="metric-percentage">
                        {stats.totalTasks > 0 ? Math.round((stats.activeTasks / stats.totalTasks) * 100) : 0}% do total
                    </p>
                </div>

                <div className="card metric-card metric-card-success-bg">
                    <h3 className="metric-label">Concluídas</h3>
                    <p className="metric-value">
                        <AnimatedCounter value={stats.completedTasks} />
                    </p>
                    <p className="metric-percentage">
                        {stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0}% finalizadas
                    </p>
                </div>

                <div
                    className="card metric-card metric-card-critical-bg"
                    onClick={() => navigate('/admin/tasks?status=overdue')}
                    role="button"
                    tabIndex={0}
                    onKeyPress={(e) => e.key === 'Enter' && navigate('/admin/tasks?status=overdue')}
                >
                    <h3 className="metric-label metric-label-critical">Atrasadas</h3>
                    <p className="metric-value metric-value-critical">
                        <AnimatedCounter value={stats.overdueTasks} />
                    </p>
                    <div className="metric-footer-row">
                        <span className="metric-badge-critical">Ver Lista</span>
                        <ExternalLink size={14} className="metric-icon-critical-small" />
                    </div>
                </div>
            </div>


            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            {/* BLOCO 3 & 4: EVOLUÇÃO E FEED OPERACIONAL         */}
            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div className="dashboard-grid-charts">
                {/* Coluna Esquerda: Gráfico de Evolução (Maior) */}
                <div className="card" style={{ minWidth: 0 }}>
                    <div className="card-header card-header-flex">
                        <h3 className="card-title">Evolução da Operação ({isMobile ? '05' : '30'} dias)</h3>
                    </div>
                    <div className="chart-container">
                        {safeChartData.length === 0 ? (
                            <div className="chart-empty-state">
                                <span>Sem dados suficientes para exibir o gráfico</span>
                            </div>
                        ) : (

                            <ResponsiveContainer width="100%" height={isMobile ? 180 : 250}>
                                <AreaChart data={safeChartData}>

                                    <defs>
                                        <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#2563EB" stopOpacity={0.14} />
                                            <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#059669" stopOpacity={0.14} />
                                            <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EDF0F3" />
                                    <XAxis
                                        dataKey="date"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fontSize: isMobile ? 11 : 12, fill: '#9CA3AF' }}
                                    />
                                    <YAxis width={isMobile ? 30 : 40}
                                        axisLine={false}
                                        tickLine={false}
                                        tickFormatter={(value) => value === 0 ? '' : value}
                                        tick={{ fontSize: isMobile ? 11 : 12, fill: '#9CA3AF' }}
                                    />
                                    <Tooltip wrapperClassName="chart-tooltip" />
                                    <Area
                                        type="monotone"
                                        dataKey={chartView === 'created' ? 'criadas' : 'concluidas'}
                                        stroke={chartView === 'created' ? '#2563EB' : '#059669'}
                                        strokeWidth={3}
                                        fillOpacity={1}
                                        fill={`url(#color${chartView === 'created' ? 'Created' : 'Completed'})`}
                                        activeDot={{ r: 6, strokeWidth: 0 }}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                {/* Coluna Direita: Feed Operacional (Decision Instrument) */}
                <div className="h-full" style={{ minWidth: 0 }}>
                    <OperationalFeed />
                </div>
            </div>

            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            {/* BLOCO 4: TAREFAS RECENTES (Restaurado)           */}
            {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div className="card">
                <div className="card-header flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <ListTodo size={18} className="text-secondary" />
                        <h3 className="card-title">Tarefas Recentes</h3>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            className="btn btn-primary btn-sm flex items-center gap-2"
                            onClick={handleCreateTask}
                        >
                            <Plus size={16} />
                            Nova Tarefa
                        </button>
                        <button
                            className="btn-link-subtle"
                            onClick={() => navigate('/admin/tasks')}
                        >
                            Ver todas →
                        </button>
                    </div>
                </div>

                <div className="recent-tasks-list">
                    {recentTasks.length === 0 ? (
                        <div className="empty-state-minimal">
                            <p>Nenhuma tarefa recente</p>
                        </div>
                    ) : (
                        recentTasks.map(task => {
                            const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== 'concluida';

                            // Client-side lookup for professional name (Safety against backend join issues)
                            const assignedProf = professionals.find(p => p.id === task.assigned_to);
                            const responsibleName = assignedProf ? assignedProf.nome : 'Não atribuída';

                            // User display logic for list
                            const displayResponsible = `Executando: ${responsibleName.split(' ')[0]}`;

                            // Date logic: Deadline relative
                            const dateDisplay = task.deadline
                                ? (isOverdue
                                    ? `Venceu ${formatDistanceToNow(new Date(task.deadline), { addSuffix: true, locale: ptBR })}`
                                    : `Vence ${formatDistanceToNow(new Date(task.deadline), { addSuffix: true, locale: ptBR })}`)
                                : 'Sem prazo';

                            return (
                                <div
                                    key={task.id}
                                    className={`task-item-minimal ${isOverdue ? 'overdue' : ''}`}
                                    onClick={() => setSelectedTask({ ...task, responsavel: { nome: responsibleName } })}
                                >
                                    <div className="task-content">
                                        <div className="task-title-row">
                                            <span className={`task-dot ${isOverdue ? 'status-dot-atrasada' : `status-dot-${task.status.toLowerCase()}`}`}></span>
                                            <span className="task-title">{task.titulo}</span>
                                        </div>
                                        <div className="task-meta">
                                            <CreatorSignature
                                                name={task.created_by_name_snapshot || task.creator?.nome}
                                                createdAt={task.created_at}
                                                compact
                                            />
                                            <span className="user-text">
                                                {displayResponsible}
                                            </span>
                                            <span className="separator">•</span>
                                            <span className="date-text">
                                                {dateDisplay}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="task-action-arrow">
                                        →
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>
            </div>

            {/* Task Summary Modal (Framer Style) */}
            {selectedTask && (
                <TaskSummaryModal
                    task={selectedTask}
                    onClose={() => setSelectedTask(null)}
                    onUpdate={fetchPainelData}
                    onEdit={handleEditTask}
                    onDelete={handleDeleteTask}
                />
            )}

            {/* Edit Task Modal */}
            <EditTaskModal
                isOpen={showEditModal}
                onClose={() => setShowEditModal(false)}
                task={selectedTask}
                onSuccess={onEditSuccess}
                currentUserId={user?.id}
            />

            {/* Confirm Delete Modal */}
            {showDeleteModal && selectedTask && (
                <ConfirmDeleteModal
                    taskTitle={selectedTask.titulo}
                    onClose={() => setShowDeleteModal(false)}
                    onConfirm={confirmDeleteTask}
                    isDeleting={isDeleting}
                />
            )}


            {/* Reatribuir Modal */}
            {
                reassigningTask && (
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
                )
            }
        </div >
    )
}

