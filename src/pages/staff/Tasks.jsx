import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../services/supabase'
import {
    Search,
    ArrowLeft,
    Calendar,
    Clock,
    AlertCircle,
    CheckCircle2,
    Send,
    ChevronRight,
    X,
    Filter
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../contexts/AuthContext'
import { useRefresh } from '../../contexts/RefreshContext'
import '../../styles/staff-tasks.css'

export default function StaffTasks() {
    const { user } = useAuth()
    const { registerRefresh, unregisterRefresh } = useRefresh()
    const [tasks, setTasks] = useState([])
    const [loading, setLoading] = useState(true)

    // View State
    const [selectedTask, setSelectedTask] = useState(null) // If set, shows ExecutionView

    // Filter State
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState('all') // all, pendente, em_progresso, concluida
    const [priorityFilter, setPriorityFilter] = useState('all') // all, urgente, alta, normal, baixa

    useEffect(() => {
        fetchTasks()

        registerRefresh(async () => {
            await fetchTasks(true)
        })

        return () => unregisterRefresh()
    }, [])

    async function fetchTasks(silent = false) {
        try {
            if (!silent) setLoading(true)

            if (!user?.id) {
                setTasks([])
                return
            }

            // Get tasks assigned to this user
            const { data, error } = await supabase
                .from('tarefas')
                .select('*')
                .eq('assigned_to', user.id)
                .order('deadline', { ascending: true, nullsFirst: false })

            if (error) throw error

            setTasks(data || [])
        } catch (error) {
            console.error('Error in fetchTasks:', error)
            toast.error('Erro ao carregar tarefas')
        } finally {
            if (!silent) setLoading(false)
        }
    }

    // Filter Logic
    const filteredTasks = tasks.filter(task => {
        // Search
        if (search) {
            const lowerDate = search.toLowerCase()
            const matchTitle = task.titulo.toLowerCase().includes(lowerDate)
            const matchDesc = task.descricao && task.descricao.toLowerCase().includes(lowerDate)
            if (!matchTitle && !matchDesc) return false
        }

        // Status
        if (statusFilter !== 'all') {
            if (statusFilter === 'active') { // Custom filter for Pending + In Progress
                if (task.status === 'concluida') return false
            } else {
                if (task.status !== statusFilter) return false
            }
        }

        // Priority
        if (priorityFilter !== 'all') {
            if (task.prioridade !== priorityFilter) return false
        }

        return true
    })

    // Actions
    async function handleUpdateStatus(taskId, newStatus) {
        try {
            const updates = {
                status: newStatus,
                concluida_at: newStatus === 'concluida' ? new Date().toISOString() : null
            }

            const { error } = await supabase
                .from('tarefas')
                .update(updates)
                .eq('id', taskId)

            if (error) throw error

            setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))

            // If currently viewing details, update that too
            if (selectedTask?.id === taskId) {
                setSelectedTask(prev => ({ ...prev, ...updates }))
            }

            if (newStatus === 'concluida') {
                toast.success('Tarefa concluída! 🎉')
            } else {
                toast.success('Status atualizado')
            }

        } catch (error) {
            console.error('Error updating status:', error)
            toast.error('Erro ao atualizar status')
        }
    }

    // --- RENDER ---

    if (loading) {
        return (
            <div className="flex justify-center items-center h-[50vh]">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            </div>
        )
    }

    // MODE: EXECUTION VIEW (Full Screen)
    if (selectedTask) {
        return (
            <ExecutionView
                task={selectedTask}
                onBack={() => setSelectedTask(null)}
                onUpdateStatus={handleUpdateStatus}
                user={user}
            />
        )
    }

    // MODE: LIST VIEW
    return (
        <div className="staff-tasks-page">
            <div className="staff-tasks-header">
                <h1>Minhas Tarefas</h1>
                <p>Gerencie suas demandas diárias.</p>
            </div>

            <div className="staff-tasks-search">
                <Search size={18} className="staff-tasks-search-icon" />
                <input
                    type="text"
                    placeholder="Buscar tarefas..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
                {search && (
                    <button onClick={() => setSearch('')} className="staff-tasks-clear-btn">
                        <X size={14} />
                    </button>
                )}
            </div>

            <div className="staff-task-filters">
                <FilterChip
                    label="Tudo"
                    active={statusFilter === 'all'}
                    onClick={() => setStatusFilter('all')}
                />
                <FilterChip
                    label="Pendentes"
                    active={statusFilter === 'pendente'}
                    onClick={() => setStatusFilter('pendente')}
                />
                <FilterChip
                    label="Em Andamento"
                    active={statusFilter === 'em_progresso'}
                    onClick={() => setStatusFilter('em_progresso')}
                />
                <FilterChip
                    label="Concluídas"
                    active={statusFilter === 'concluida'}
                    onClick={() => setStatusFilter('concluida')}
                />
                <div className="staff-task-filter-separator"></div>
                <FilterChip
                    label="Alta Prioridade"
                    active={priorityFilter === 'alta'}
                    onClick={() => setPriorityFilter(priorityFilter === 'alta' ? 'all' : 'alta')}
                />
            </div>

            <div className="staff-tasks-list">
                {filteredTasks.length === 0 ? (
                    <div className="staff-tasks-empty">
                        <Filter size={48} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                        <p>Nenhuma tarefa encontrada.</p>
                    </div>
                ) : (
                    filteredTasks.map(task => (
                        <TaskCard
                            key={task.id}
                            task={task}
                            onClick={() => setSelectedTask(task)}
                        />
                    ))
                )}
            </div>
        </div>
    )
}

function FilterChip({ label, active, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`staff-task-filter ${active ? 'active' : ''}`}
        >
            {label}
        </button>
    )
}

function TaskCard({ task, onClick }) {
    const isOverdue = new Date(task.deadline) < new Date() && task.status !== 'concluida'
    const statusClass = task.status === 'concluida' ? 'status-completed' : task.status === 'em_progresso' ? 'status-in-progress' : 'status-pending'
    const statusText = task.status === 'concluida' ? 'Concluída' : task.status === 'em_progresso' ? 'Em Andamento' : 'Pendente'

    return (
        <button
            onClick={onClick}
            className={`staff-task-card ${isOverdue ? 'overdue' : ''}`}
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
        </button>
    )
}

function ExecutionView({ task, onBack, onUpdateStatus, user }) {
    const isCompleted = task.status === 'concluida'

    // Simple state for comments/timeline
    const [timeline, setTimeline] = useState([])
    const [comment, setComment] = useState('')

    useEffect(() => {
        // Fetch timeline logic (Simplified for this view)
        async function loadTimeline() {
            const { data } = await supabase
                .from('task_comments')
                .select('id, content, created_at, profissionais(nome)')
                .eq('task_id', task.id)
                .order('created_at', { ascending: true })

            if (data) setTimeline(data)
        }
        loadTimeline()
    }, [task.id])

    async function sendComment(e) {
        e.preventDefault()
        if (!comment.trim()) return

        try {
            await supabase.from('task_comments').insert({
                task_id: task.id,
                author_id: user.id,
                content: comment
            })
            setComment('')
            // Optimistic update
            setTimeline(prev => [...prev, {
                id: Date.now(),
                content: comment,
                created_at: new Date(),
                profissionais: { nome: 'Você' }
            }])
        } catch (err) {
            toast.error('Erro ao enviar')
        }
    }

    return (
        <div className="fixed inset-0 bg-white z-50 flex flex-col animate-in slide-in-from-right duration-300">
            {/* Header */}
            <div className="h-16 px-4 flex items-center gap-3 border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-10">
                <button onClick={onBack} className="p-2 -ml-2 text-gray-600 hover:bg-gray-100 rounded-full">
                    <ArrowLeft size={24} />
                </button>
                <div className="flex-1 min-w-0">
                    <h2 className="font-bold text-gray-900 truncate text-lg leading-tight">{task.titulo}</h2>
                </div>
                <div className={`
                    w-3 h-3 rounded-full mr-2
                    ${isCompleted ? 'bg-green-500' : task.status === 'em_progresso' ? 'bg-blue-500' : 'bg-orange-500 shadow-orange-200 shadow-md animate-pulse'}
                `}></div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 pb-32">
                {/* Status Card */}
                <div className="bg-gray-50 rounded-xl p-4 mb-6 border border-gray-100">
                    <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Status Atual</span>
                        {task.deadline && (
                            <span className="text-xs font-medium text-gray-500 bg-white px-2 py-1 rounded shadow-sm">
                                Prazo: {new Date(task.deadline).toLocaleDateString('pt-BR')}
                            </span>
                        )}
                    </div>
                    <div className="text-lg font-medium text-gray-900">
                        {isCompleted ? 'Concluída' : task.status === 'em_progresso' ? 'Em Andamento' : 'Pendente'}
                    </div>
                </div>

                {/* Description */}
                <div className="mb-8">
                    <h3 className="text-sm font-bold text-gray-900 mb-2">Descrição</h3>
                    <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap">
                        {task.descricao || 'Sem descrição.'}
                    </p>
                </div>

                {/* Link */}
                {task.drive_link && (
                    <a
                        href={task.drive_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full p-4 bg-blue-50 border border-blue-100 rounded-xl text-blue-700 font-medium text-center mb-8 active:scale-[0.98] transition-transform"
                    >
                        Abrir Arquivos Anexos
                    </a>
                )}

                {/* Timeline / Comments */}
                <div>
                    <h3 className="text-sm font-bold text-gray-900 mb-4">Atividade & Notas</h3>
                    <div className="space-y-4 mb-4">
                        {timeline.length === 0 ? (
                            <p className="text-gray-400 text-xs italic">Nenhuma nota ainda.</p>
                        ) : (
                            timeline.map(item => (
                                <div key={item.id} className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs font-bold text-gray-700">{item.profissionais?.nome || 'Usuário'}</span>
                                        <span className="text-[10px] text-gray-400">{new Date(item.created_at).toLocaleDateString()}</span>
                                    </div>
                                    <p className="text-sm text-gray-600">{item.content}</p>
                                </div>
                            ))
                        )}
                    </div>

                    <form onSubmit={sendComment} className="relative">
                        <input
                            type="text"
                            placeholder="Adicionar nota rápida..."
                            className="w-full pl-4 pr-12 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                        />
                        <button
                            type="submit"
                            disabled={!comment.trim()}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-gray-900 text-white rounded-lg disabled:opacity-50 disabled:bg-gray-300"
                        >
                            <Send size={14} />
                        </button>
                    </form>
                </div>
            </div>

            {/* Footer / Thumb Zone Actions */}
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100 pb-8 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
                <div className="max-w-lg mx-auto flex gap-3">
                    {!isCompleted ? (
                        <>
                            {task.status === 'pendente' && (
                                <button
                                    onClick={() => onUpdateStatus(task.id, 'em_progresso')}
                                    className="flex-1 py-4 bg-gray-100 text-gray-900 font-bold rounded-xl active:scale-[0.98] transition-transform"
                                >
                                    Iniciar
                                </button>
                            )}
                            <button
                                onClick={() => onUpdateStatus(task.id, 'concluida')}
                                className="flex-[2] py-4 bg-gray-900 text-white font-bold rounded-xl shadow-lg shadow-gray-200 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
                            >
                                <CheckCircle2 size={20} />
                                Concluir Tarefa
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={() => onUpdateStatus(task.id, 'em_progresso')}
                            className="w-full py-4 bg-gray-100 text-gray-600 font-bold rounded-xl active:scale-[0.98] transition-transform"
                        >
                            Reabrir Tarefa
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
