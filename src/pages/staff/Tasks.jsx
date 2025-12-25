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
    Filter,
    Lock
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../contexts/AuthContext'
import { useRefresh } from '../../contexts/RefreshContext'
import '../../styles/staff-tasks.css'
import '../../styles/task-detail.css'

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

            // HYBRID QUERY: Fetch micro tasks + legacy tasks

            // 1. Fetch micro tasks assigned to this user
            const { data: microTasks, error: microError } = await supabase
                .from('tarefas_micro')
                .select(`
                    *,
                    tarefas (
                        id,
                        titulo,
                        descricao,
                        deadline,
                        prioridade
                    )
                `)
                .eq('profissional_id', user.id)
                .order('created_at', { ascending: false })

            if (microError) {
                console.error('Error fetching micro tasks:', microError)
            }

            // 2. Fetch legacy tasks (tasks without micro tasks)
            const { data: legacyTasks, error: legacyError } = await supabase
                .from('tarefas')
                .select('*')
                .eq('assigned_to', user.id)
                .order('deadline', { ascending: true, nullsFirst: false })

            if (legacyError) {
                console.error('Error fetching legacy tasks:', legacyError)
            }

            // 3. Merge and normalize tasks
            const allTasks = []

            // Add micro tasks (with special flag)
            if (microTasks) {
                microTasks.forEach(mt => {
                    allTasks.push({
                        ...mt,
                        // Normalize structure for compatibility
                        id: mt.id,
                        titulo: mt.tarefas?.titulo || 'Tarefa sem título',
                        descricao: mt.tarefas?.descricao,
                        deadline: mt.tarefas?.deadline,
                        prioridade: mt.tarefas?.prioridade || 'normal',
                        status: mt.status, // Use micro task status
                        funcao: mt.funcao, // Micro task specific
                        is_micro_task: true, // Flag for UI
                        tarefa_id: mt.tarefa_id, // Reference to macro task
                        depends_on: mt.depends_on, // Dependency
                        peso: mt.peso
                    })
                })
            }

            // Add legacy tasks (only if they don't have micro tasks)
            if (legacyTasks) {
                // Filter out macro tasks that have micro tasks
                const macroTaskIds = new Set(microTasks?.map(mt => mt.tarefa_id) || [])

                legacyTasks.forEach(task => {
                    if (!macroTaskIds.has(task.id)) {
                        allTasks.push({
                            ...task,
                            is_micro_task: false // Flag for UI
                        })
                    }
                })
            }

            setTasks(allTasks)
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

    // Handle different status values for micro tasks
    const statusClass = task.status === 'concluida' ? 'status-completed'
        : task.status === 'em_execucao' ? 'status-in-progress'
            : task.status === 'bloqueada' ? 'status-blocked'
                : task.status === 'devolvida' ? 'status-returned'
                    : 'status-pending'

    const statusText = task.status === 'concluida' ? 'Concluída'
        : task.status === 'em_execucao' ? 'Em Andamento'
            : task.status === 'bloqueada' ? 'Bloqueada'
                : task.status === 'devolvida' ? 'Devolvida'
                    : 'Pendente'

    return (
        <button
            onClick={onClick}
            className={`staff-task-card ${isOverdue ? 'overdue' : ''} ${task.status === 'bloqueada' ? 'blocked' : ''}`}
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

                {/* Micro Task Function Badge */}
                {task.is_micro_task && task.funcao && (
                    <span className="micro-task-badge">{task.funcao}</span>
                )}

                <h3 className="staff-task-title">
                    {task.titulo}
                </h3>

                {/* Dependency Indicator */}
                {task.status === 'bloqueada' && (
                    <div className="dependency-indicator">
                        <Lock size={14} />
                        <span>Aguardando etapa anterior</span>
                    </div>
                )}

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

    const statusClass = isCompleted ? 'completed' : task.status === 'em_progresso' ? 'active' : 'pending'
    const statusText = isCompleted ? 'Concluída' : task.status === 'em_progresso' ? 'Em Andamento' : 'Pendente'

    return (
        <div className="task-detail-container">
            {/* Header */}
            <div className="task-detail-header">
                <button onClick={onBack} className="task-detail-back-btn">
                    <ArrowLeft size={24} />
                </button>
                <div className="task-detail-header-content">
                    <h2 className="task-title">{task.titulo}</h2>
                </div>
                <div className={`task-status-indicator ${statusClass}`}></div>
            </div>

            {/* Body */}
            <div className="task-detail-body">
                {/* Status Card */}
                <div className="task-status-block">
                    <div className="task-status-block-header">
                        <span className="task-status-label">Status Atual</span>
                        {task.deadline && (
                            <span className="task-deadline">
                                Prazo: {new Date(task.deadline).toLocaleDateString('pt-BR')}
                            </span>
                        )}
                    </div>
                    <div className={`task-status ${statusClass}`}>
                        {statusText}
                    </div>
                </div>

                {/* Description */}
                <div className="task-section">
                    <h3 className="task-section-title">Descrição</h3>
                    <div className="task-description">
                        {task.descricao || 'Sem descrição.'}
                    </div>
                </div>

                {/* Link */}
                {task.drive_link && (
                    <a
                        href={task.drive_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="task-link"
                    >
                        Abrir Arquivos Anexos
                    </a>
                )}

                {/* Timeline / Comments */}
                <div className="task-notes">
                    <h3 className="task-section-title">Atividade & Notas</h3>
                    <div className="task-notes-list">
                        {timeline.length === 0 ? (
                            <p className="task-notes-empty">Nenhuma nota ainda.</p>
                        ) : (
                            timeline.map(item => (
                                <div key={item.id} className="task-note-item">
                                    <div className="task-note-header">
                                        <span className="task-note-author">{item.profissionais?.nome || 'Usuário'}</span>
                                        <span className="task-note-date">{new Date(item.created_at).toLocaleDateString()}</span>
                                    </div>
                                    <p className="task-note-content">{item.content}</p>
                                </div>
                            ))
                        )}
                    </div>

                    <form onSubmit={sendComment} className="task-note-form">
                        <input
                            type="text"
                            placeholder="Adicionar nota rápida..."
                            className="task-note-input"
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                        />
                        <button
                            type="submit"
                            disabled={!comment.trim()}
                            className="task-note-submit"
                        >
                            <Send size={14} />
                        </button>
                    </form>
                </div>
            </div>

            {/* Footer / Actions */}
            <div className="task-actions">
                <div className="task-actions-inner">
                    {!isCompleted ? (
                        <>
                            {task.status === 'pendente' && (
                                <button
                                    onClick={() => onUpdateStatus(task.id, 'em_progresso')}
                                    className="task-btn-secondary"
                                >
                                    Iniciar
                                </button>
                            )}
                            <button
                                onClick={() => onUpdateStatus(task.id, 'concluida')}
                                className="task-btn-primary"
                            >
                                <CheckCircle2 size={20} />
                                Concluir Tarefa
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={() => onUpdateStatus(task.id, 'em_progresso')}
                            className="task-btn-reopen"
                        >
                            Reabrir Tarefa
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
