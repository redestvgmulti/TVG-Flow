import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
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
    Lock,
    FileText,
    ExternalLink,
    Trash2,
    Workflow,
    Paperclip,
    Download
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../contexts/AuthContext'
import { useRefresh } from '../../contexts/RefreshContext'
import CreatorSignature from '../../components/ui/CreatorSignature'
import { fileService } from '../../services/fileService'
import ReturnReasonModal from '../../components/ReturnReasonModal'
import EditTaskModal from '../../components/EditTaskModal'
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal'
import Timeline from '../../components/Timeline'
import ComentarioForm from '../../components/ComentarioForm'
import { Edit2 } from 'lucide-react'
import ConversaoWorkflowModal from '../../components/ConversaoWorkflowModal'
import PermissionGuard from '../../components/PermissionGuard'
import { normalizeStatus, isValidStatus } from '../../utils/validators'
import '../../styles/staff-tasks.css'
import '../../styles/task-details.css'

export default function StaffTasks() {
    const { user, role } = useAuth()
    const { registerRefresh, unregisterRefresh } = useRefresh()
    const [tasks, setTasks] = useState([])
    const [loading, setLoading] = useState(true)

    // View State
    // View State
    const [selectedTask, setSelectedTask] = useState(null) // If set, shows ExecutionView
    const [taskToConvert, setTaskToConvert] = useState(null) // OS selecionada para conversão

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
        if (!user?.id) return

        try {
            setLoading(true)

            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // ETAPA 2: QUERY UNIFICADA
            // Busca TODAS as OS (simples + complexas) em UMA query
            // RLS automática filtra: created_by, assigned_to, micro-tasks
            // PERFORMANCE: Hard limit para prevenir sobrecarga (RLS já filtra por profissional)
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

            const { data, error } = await supabase
                .from('tarefas')
                .select(`
                    *,
                    criador:created_by (
                        id,
                        nome
                    ),
                    cliente:empresas!cliente_id (
                        id,
                        nome
                    ),
                    tarefas_micro (
                        id,
                        profissional_id,
                        status,
                        funcao,
                        peso,
                        depends_on,
                        created_at,
                        updated_at
                    )
                `)
                .order('deadline', { ascending: true })  // Ordenar por prazo (mais urgente primeiro)
                .limit(500)

            if (error) throw error

            // Processar resultado: separar OS simples de OS complexas
            const allTasks = []

            data?.forEach(osTask => {
                // Verifica se tem micro-tasks associadas
                const microTasks = osTask.tarefas_micro || []
                const temWorkflow = microTasks.length > 0

                if (temWorkflow) {
                    // OS COMPLEXA: Criar uma tarefa por micro-task atribuída ao usuário
                    const myMicroTasks = microTasks.filter(mt => mt.profissional_id === user.id)

                    myMicroTasks.forEach(mt => {
                        allTasks.push({
                            // Dados da micro-task
                            id: mt.id,
                            status: mt.status,
                            funcao: mt.funcao,
                            entrega_link: mt.entrega_link,
                            observacoes: mt.observacoes,
                            depends_on: mt.depends_on,
                            peso: mt.peso,
                            created_at: mt.created_at,
                            os_created_at: osTask.created_at,
                            updated_at: mt.updated_at,
                            concluida_at: mt.concluida_at,

                            // Dados da macro-task (OS)
                            titulo: osTask.titulo,
                            descricao: osTask.descricao,
                            deadline: osTask.deadline,
                            prioridade: osTask.prioridade,
                            drive_link: osTask.drive_link,

                            // Criador da OS & Empresa
                            criador_id: osTask.criador?.id || null,
                            created_by_name_snapshot: osTask.created_by_name_snapshot,
                            criador_nome: osTask.created_by_name_snapshot || osTask.criador?.nome || null,
                            cliente_nome: osTask.cliente?.nome || '',

                            // Flags e referências
                            is_micro_task: true,
                            is_os_complexa: true,
                            is_os_simples: false,
                            tarefa_id: osTask.id,
                            tem_workflow: true
                        })
                    })
                } else {
                    // OS SIMPLES: Mostrar a tarefa principal diretamente
                    allTasks.push({
                        ...osTask,
                        // Ensure we map the joined data correctly for simple tasks too
                        criador_nome: osTask.created_by_name_snapshot || osTask.criador?.nome || null,
                        cliente_nome: osTask.cliente?.nome || '',
                        is_micro_task: false,
                        is_os_simples: true,
                        is_os_complexa: false,
                        tem_workflow: false
                    })
                }
            })

            setTasks(allTasks)
        } catch (error) {
            console.error('Error in fetchTasks:', error)
            toast.error('Erro ao carregar tarefas')
        } finally {
            setLoading(false)
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // SMART SORTING: Prioritize current tasks over very old ones
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    function smartSortTasks(tasksToSort) {
        const now = new Date()
        const sixtyDaysAgo = new Date()
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)

        // Separate into 3 buckets
        const urgentAndCurrent = [] // Not completed, deadline within next 60 days or recent overdue
        const veryOverdue = []       // Not completed, deadline > 60 days ago
        const completed = []         // All completed tasks

        tasksToSort.forEach(task => {
            if (task.status === 'concluida') {
                completed.push(task)
            } else if (task.deadline) {
                const taskDeadline = new Date(task.deadline)
                if (taskDeadline < sixtyDaysAgo) {
                    veryOverdue.push(task)
                } else {
                    urgentAndCurrent.push(task)
                }
            } else {
                // No deadline = urgent (needs attention)
                urgentAndCurrent.push(task)
            }
        })

        // Sort each bucket by deadline ASC (closest first)
        const sortByDeadline = (a, b) => {
            if (!a.deadline) return 1
            if (!b.deadline) return -1
            return new Date(a.deadline) - new Date(b.deadline)
        }

        urgentAndCurrent.sort(sortByDeadline)
        veryOverdue.sort(sortByDeadline)
        completed.sort(sortByDeadline)

        // Concatenate: urgent → very overdue → completed
        return [...urgentAndCurrent, ...veryOverdue, ...completed]
    }

    // Filter Logic
    const filteredTasks = smartSortTasks(tasks.filter(task => {
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
        } else {
            // CRITICAL: 'all' tab should ONLY show non-completed tasks
            // Completed tasks appear only in 'concluida' tab
            if (task.status === 'concluida') return false
        }

        // Priority
        if (priorityFilter !== 'all') {
            if (task.prioridade !== priorityFilter) return false
        }

        return true
    }))

    // Actions
    async function handleUpdateStatus(taskId, newStatus) {
        try {
            // Find the task to check if it's a micro task
            const task = tasks.find(t => t.id === taskId) || selectedTask

            // MICRO TASK: Use Edge Function
            if (task?.is_micro_task) {
                // Prevent completing blocked tasks
                if (newStatus === 'concluida' && task.status === 'bloqueada') {
                    toast.error('Esta tarefa está bloqueada. Aguarde a conclusão da etapa anterior.')
                    return
                }

                // Map generic 'em_progresso' to micro-task specific 'em_execucao'
                let statusToSend = newStatus
                if (newStatus === 'em_progresso') {
                    statusToSend = 'em_execucao'
                }

                if (newStatus === 'concluida') {
                    // Call complete-micro-task Edge Function
                    const { data, error } = await supabase.functions.invoke('complete-micro-task', {
                        body: {
                            micro_task_id: taskId
                        }
                    })

                    if (error) throw error

                    if (!data || !data.success) {
                        throw new Error(data?.error || 'Falha ao concluir micro tarefa')
                    }

                    toast.success('Micro tarefa concluída! 🎉')
                } else {
                    // Validate status before updating
                    const validStatuses = ['pendente', 'em_execucao', 'concluida', 'bloqueada', 'devolvida']
                    if (!validStatuses.includes(statusToSend)) {
                        throw new Error(`Status inválido: ${statusToSend}. Valores permitidos: ${validStatuses.join(', ')}`)
                    }

                    // For other status changes (em_execucao, etc), update directly
                    const { error } = await supabase
                        .from('tarefas_micro')
                        .update({ status: statusToSend })
                        .eq('id', taskId)

                    if (error) throw error
                    toast.success('Status atualizado')
                }

                // Update local state
                setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: statusToSend } : t))
                if (selectedTask?.id === taskId) {
                    setSelectedTask(prev => ({ ...prev, status: statusToSend }))
                }

                // Refresh tasks to get updated macro task progress
                fetchTasks()
            }
            // LEGACY TASK: Direct update
            else {
                // Normalize status (e.g. em_progresso -> em_execucao)
                const normalizedStatus = normalizeStatus(newStatus)

                // Validate before sending
                if (!isValidStatus(normalizedStatus)) {
                    console.error(`Invalid status for tarefas table: ${normalizedStatus} (original: ${newStatus})`)
                    // Optionally fallback or error
                    // But if it's 'bloqueada' or 'devolvida' trying to go to macro task, we should block it?
                    // Macro tasks usually don't have blocked/devolvida state in strict mode.
                    // But for now, let's just proceed if valid, else throw.
                    throw new Error(`Status inválido para tarefa macro: ${normalizedStatus}`)
                }

                const updates = {
                    status: normalizedStatus,
                    concluida_at: normalizedStatus === 'concluida' ? new Date().toISOString() : null
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

                if (normalizedStatus === 'concluida') {
                    toast.success('Tarefa concluída! 🎉')
                } else {
                    toast.success('Status atualizado')
                }
            }

        } catch (error) {
            console.error('Error updating status:', error)
            toast.error(error.message || 'Erro ao atualizar status')
        }
    }

    async function handleDeleteTask(taskId) {
        try {
            const task = tasks.find(t => t.id === taskId) || selectedTask

            // Only allow creator to delete
            if (task?.created_by !== user.id) {
                toast.error('Apenas quem criou a tarefa pode excluí-la')
                return
            }

            // For legacy tasks, delete directly from database
            if (!task.is_micro_task) {
                const { error } = await supabase
                    .from('tarefas')
                    .delete()
                    .eq('id', taskId)

                if (error) throw error

                // Remove from local state (affects current user's UI)
                setTasks(prev => prev.filter(t => t.id !== taskId))

                // Close details view if open
                if (selectedTask?.id === taskId) {
                    setSelectedTask(null)
                }

                toast.success('Tarefa excluída com sucesso')
            } else {
                // For micro tasks, would need different logic
                toast.error('Não é possível excluir micro tarefas individualmente')
            }

        } catch (error) {
            console.error('Error deleting task:', error)
            toast.error(error.message || 'Erro ao excluir tarefa')
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
                onDeleteTask={handleDeleteTask}
                user={user}
                role={role}
                setTaskToConvert={setTaskToConvert}
                taskToConvert={taskToConvert}
                onRefresh={fetchTasks}
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
                    label="Em Andamento"
                    active={statusFilter === 'em_execucao'}
                    onClick={() => setStatusFilter('em_execucao')}
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

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                    <CreatorSignature
                        name={task.created_by_name_snapshot || task.criador_nome}
                        createdAt={task.os_created_at || task.created_at}
                        compact
                    />
                    {task.cliente_nome && (
                        <span className="origin-company">{task.cliente_nome}</span>
                    )}
                </div>

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

function ExecutionView({ task, onBack, onUpdateStatus, onDeleteTask, user, role, setTaskToConvert, taskToConvert, onRefresh }) {
    const isCompleted = task.status === 'concluida'
    const isCreator = task.created_by === user.id

    // Attachments State
    const [attachments, setAttachments] = useState([])
    const [loadingAttachments, setLoadingAttachments] = useState(false)

    useEffect(() => {
        loadAttachments()
    }, [task.id])

    async function loadAttachments() {
        try {
            setLoadingAttachments(true)
            // Use parent task ID if it's a micro task, or the task ID itself
            // Actually, we attach to the task ID effectively.
            // If it's a micro task, the attachment might be on the macro task (tarefa_id).
            // Let's check both or prefer macro task if available.
            // Logic: if micro task, attachments are likely on the macro task (the "OS").
            const targetId = task.tarefa_id || task.id
            const files = await fileService.getTaskAttachments(targetId)
            setAttachments(files || [])
        } catch (error) {
            console.error('Error loading attachments:', error)
            toast.error('Erro ao carregar anexos')
        } finally {
            setLoadingAttachments(false)
        }
    }

    async function handleDownload(file) {
        try {
            toast.loading('Preparando download...', { id: 'download' })
            const url = await fileService.getDownloadUrl(file.storage_path)

            // Create temporary link and click it
            const a = document.createElement('a')
            a.href = url
            a.download = file.original_filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)

            toast.dismiss('download')
        } catch (error) {
            console.error('Download error:', error)
            toast.error('Erro ao baixar arquivo')
        }
    }

    async function handleDeleteAttachment(fileId) {
        if (!confirm('Tem certeza que deseja excluir este anexo?')) return

        try {
            toast.loading('Excluindo...', { id: 'delete-file' })
            await fileService.deleteAttachment(fileId)

            setAttachments(prev => prev.filter(f => f.id !== fileId))
            toast.success('Arquivo excluído')
            toast.dismiss('delete-file')
        } catch (error) {
            console.error('Delete error:', error)
            toast.error('Erro ao excluir arquivo')
        }
    }

    // Return modal state
    const [showReturnModal, setShowReturnModal] = useState(false)
    const [professionals, setProfessionals] = useState([])
    const [loadingProfessionals, setLoadingProfessionals] = useState(false)

    // Delete confirmation modal state
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [showEditModal, setShowEditModal] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

    // Timeline refresh key (para forçar refresh após adicionar comentário)
    const [timelineKey, setTimelineKey] = useState(0)

    function refreshTimeline() {
        setTimelineKey(prev => prev + 1)
    }

    async function loadProfessionalsForReturn() {
        if (!task.is_micro_task || !task.tarefa_id) {
            console.warn('[loadProfessionalsForReturn] Invalid task for return:', { is_micro_task: task.is_micro_task, tarefa_id: task.tarefa_id })
            toast.error('Tarefa inválida para solicitação de ajuste')
            return
        }

        try {
            setLoadingProfessionals(true)

            // Buscar ordem da tarefa atual (se existe)
            const { data: currentTask } = await supabase
                .from('tarefas_micro')
                .select('ordem')
                .eq('id', task.id)
                .maybeSingle()

            const currentOrder = currentTask?.ordem

            // Buscar profissionais (com ou sem filtro de ordem)
            let query = supabase
                .from('tarefas_micro')
                .select(`
                    profissional_id,
                    funcao,
                    ordem,
                    profissionais!inner (
                        id,
                        nome
                    )
                `)
                .eq('tarefa_id', task.tarefa_id)
                .neq('profissional_id', user.id)

            // Se tem ordem, filtra APENAS etapas anteriores
            if (currentOrder != null && currentOrder > 1) {
                query = query.lt('ordem', currentOrder).order('ordem', { ascending: false })
            } else if (currentOrder === 1) {
                // 🎯 FIX: Primeira etapa - devolver para o CRIADOR da OS

                // Buscar criador da OS
                const { data: osData, error: osError } = await supabase
                    .from('tarefas')
                    .select('created_by, profissionais!created_by(id, nome)')
                    .eq('id', task.tarefa_id)
                    .single()

                if (osError || !osData?.profissionais) {
                    console.error('[loadProfessionalsForReturn] Failed to get OS creator:', osError)
                    toast.error('Erro ao buscar criador da OS')
                    setShowReturnModal(false)
                    return
                }

                // Retornar apenas o criador como opção
                setProfessionals([{
                    profissional_id: osData.profissionais.id,
                    funcao: 'CRIADOR DA OS',
                    ordem: 0, // Ordem 0 = criador
                    profissionais: {
                        id: osData.profissionais.id,
                        nome: osData.profissionais.nome
                    }
                }])
                setLoadingProfessionals(false)
                return
            }
            // Se currentOrder é null, busca todos (tarefa antiga sem ordem)

            const { data, error } = await query

            if (error) {
                console.error('[loadProfessionalsForReturn] Query failed:', error)
                toast.error('Erro ao carregar lista de profissionais. Por favor, tente novamente.')
                setShowReturnModal(false)
                return
            }

            if (!data || data.length === 0) {
                console.warn('[loadProfessionalsForReturn] No other professionals found:', {
                    tarefa_id: task.tarefa_id,
                    current_ordem: currentOrder
                })
                toast.warning('Não há outros profissionais disponíveis para devolução.')
                setShowReturnModal(false)
                return
            }

            setProfessionals(data || [])
        } catch (error) {
            console.error('[loadProfessionalsForReturn] Unexpected error:', error)
            toast.error('Erro inesperado ao carregar profissionais. Por favor, recarregue a página.')
            setShowReturnModal(false)
        } finally {
            setLoadingProfessionals(false)
        }
    }

    async function handleReturnTask(payload) {
        try {
            const { data, error } = await supabase.functions.invoke('return-micro-task', {
                body: payload
            })

            if (error) throw error

            if (!data || !data.success) {
                throw new Error(data?.error || 'Falha ao devolver tarefa')
            }

            toast.success('Tarefa devolvida com sucesso')
            setShowReturnModal(false)
            onBack() // Return to task list
        } catch (error) {
            console.error('Error returning task:', error)
            toast.error(error.message || 'Erro ao devolver tarefa')
        }
    }

    function openReturnModal() {
        loadProfessionalsForReturn()
        setShowReturnModal(true)
    }

    async function handleConfirmDelete() {
        setIsDeleting(true)
        try {
            await onDeleteTask(task.id)
            setShowDeleteModal(false)
        } catch (error) {
            console.error('Delete error:', error)
        } finally {
            setIsDeleting(false)
        }
    }

    const statusClass = isCompleted ? 'completed' : (task.status === 'em_progresso' || task.status === 'em_execucao') ? 'active' : 'pending'
    const statusText = isCompleted ? 'Concluída' : (task.status === 'em_progresso' || task.status === 'em_execucao') ? 'Em Andamento' : 'Pendente'

    return (
        <div className="execution-container">
            {/* --- HEADER (Normal Flow) --- */}
            <div className="execution-header">
                {/* Breadcrumb / Back */}
                <div className="execution-breadcrumbs">
                    <span onClick={onBack}>
                        <ArrowLeft size={16} />
                        Voltar para Lista
                    </span>
                </div>

                {/* Title */}
                <div className="execution-title-row">
                    <h1 className="execution-title">{task.titulo}</h1>
                </div>

                {/* Origin Info (New) */}
                {(task.criador_nome || task.created_by_name_snapshot || task.cliente_nome) && (
                    <div className="execution-origin-info" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', color: '#6B7280' }}>
                        <CreatorSignature
                            name={task.created_by_name_snapshot || task.criador_nome}
                            createdAt={task.os_created_at || task.created_at}
                            compact
                        />
                        {task.cliente_nome && (
                            <span className="origin-company" style={{ fontWeight: 500, color: '#4B5563' }}>
                                {task.cliente_nome}
                            </span>
                        )}
                    </div>
                )}

                {/* Meta Data Grid */}
                <div className="execution-meta-grid">
                    {/* Status Badge */}
                    <span className={`meta-badge status-${task.status === 'concluida' ? 'completed' : (task.status === 'em_progresso' || task.status === 'em_execucao') ? 'active' : 'pending'}`}>
                        {isCompleted && <CheckCircle2 size={14} />}
                        {(task.status === 'em_progresso' || task.status === 'em_execucao') && <Clock size={14} />}
                        {statusText}
                    </span>

                    {/* Type Badge */}
                    <span className="meta-badge type-workflow">
                        {task.is_micro_task ? <Workflow size={14} /> : <FileText size={14} />}
                        {task.is_micro_task ? 'Micro-tarefa' : 'OS Padrão'}
                    </span>

                    {/* Deadline */}
                    {task.deadline && (
                        <span className="priority-indicator">
                            <Calendar size={14} />
                            {new Date(task.deadline).toLocaleDateString('pt-BR')}
                        </span>
                    )}

                    {/* Priority */}
                    {task.prioridade === 'urgente' && (
                        <span className="priority-indicator urgent">
                            <AlertCircle size={14} />
                            Urgente
                        </span>
                    )}
                </div>
            </div>

            {/* --- SCROLLABLE CONTENT --- */}
            <div className="execution-content">

                {/* Description Section */}
                <section className="execution-section">
                    <div className="execution-section-title">
                        <FileText size={14} />
                        Sobre a Tarefa
                    </div>
                    <div className="description-card">
                        <div className={`description-text ${!task.descricao ? 'description-empty' : ''}`}>
                            {task.descricao || 'Sem descrição fornecida para esta tarefa.'}
                        </div>

                        {/* Drive Link - View Mode */}
                        {task.drive_link && (
                            <div className="drive-link-wrapper">
                                <a
                                    href={task.drive_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="drive-btn"
                                >
                                    <ExternalLink size={18} />
                                    Acessar Arquivos no Drive
                                </a>
                            </div>
                        )}

                        {/* Drive Link - Edit Mode (Input) */}
                        {!isCompleted && (
                            <div className="drive-link-wrapper">
                                <input
                                    type="url"
                                    placeholder={task.drive_link ? "Atualizar link do Drive..." : "Adicionar link do Drive..."}
                                    className="drive-link-input"
                                    defaultValue={task.drive_link || ''}
                                    onBlur={async (e) => {
                                        const newLink = e.target.value.trim()
                                        if (newLink === task.drive_link) return

                                        try {
                                            const tableName = task.is_micro_task ? 'tarefas_micro' : 'tarefas'
                                            const { error } = await supabase
                                                .from(tableName)
                                                .update({ drive_link: newLink || null })
                                                .eq('id', task.id)

                                            if (error) throw error
                                            toast.success('Link atualizado!')
                                        } catch (error) {
                                            console.error('Error updating link:', error)
                                            toast.error('Erro ao atualizar link')
                                        }
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </section>

                {/* Attachments Section */}
                {attachments.length > 0 && (
                    <section className="execution-section">
                        <div className="execution-section-title">
                            <Paperclip size={14} />
                            Anexos ({attachments.length})
                        </div>
                        <div className="attachments-grid">
                            {attachments.map(file => (
                                <div key={file.id} className="attachment-card">
                                    <div className="attachment-icon">
                                        <FileText size={20} className="text-secondary" />
                                    </div>
                                    <div className="attachment-info">
                                        <span className="attachment-name" title={file.original_filename}>
                                            {file.original_filename}
                                        </span>
                                        <span className="attachment-size">
                                            {(file.file_size / 1024).toFixed(0)} KB
                                        </span>
                                    </div>
                                    <div className="attachment-actions">
                                        <button
                                            onClick={() => handleDownload(file)}
                                            className="attachment-action-btn"
                                            title="Baixar"
                                        >
                                            <Download size={14} />
                                        </button>
                                        {/* Allow delete if user is owner or admin */}
                                        {(file.uploaded_by === user.id || role === 'admin' || role === 'super_admin') && (
                                            <button
                                                onClick={() => handleDeleteAttachment(file.id)}
                                                className="attachment-action-btn destructive"
                                                title="Excluir"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Return/Block Reason */}
                {(task.status === 'devolvida' || task.status === 'bloqueada') && task.observacoes && (
                    <section className="execution-section">
                        <div className="execution-section-title" style={{ color: '#ef4444' }}>
                            <AlertCircle size={14} />
                            {task.status === 'devolvida' ? 'Motivo da Devolução' : 'Motivo do Bloqueio'}
                        </div>
                        <div className="description-card" style={{ borderColor: '#fca5a5', background: '#fef2f2' }}>
                            <p style={{ color: '#991b1b', margin: 0 }}>{task.observacoes}</p>
                        </div>
                    </section>
                )}

                {/* Timeline Section */}
                <section className="execution-section timeline-section">
                    <div className="execution-section-title">
                        <Clock size={14} />
                        Histórico & Comentários
                    </div>

                    <Timeline
                        osId={task.tarefa_id || task.id}
                        key={timelineKey}
                    />

                    <div style={{ marginTop: '24px' }}>
                        <ComentarioForm
                            taskId={task.tarefa_id || task.id}
                            onCommentAdded={refreshTimeline}
                        />
                    </div>
                </section>
            </div>

            {/* --- STICKY ACTIONS BAR --- */}
            <div className="actions-bar">
                {/* Secondary Group (Left) */}
                <div className="actions-group-secondary">
                    {/* Delete (Icon Only) */}
                    {isCreator && !task.is_micro_task && (
                        <button
                            className="btn-destructive-icon"
                            onClick={() => setShowDeleteModal(true)}
                            title="Excluir Tarefa"
                        >
                            <Trash2 size={20} />
                        </button>
                    )}
                    {/* Edit (Icon Only) - Creator Only */}
                    {isCreator && (
                        <button
                            className="btn-action secondary"
                            onClick={() => setShowEditModal(true)}
                            title="Editar OS"
                            style={{ padding: '8px' }}
                        >
                            <Edit2 size={20} />
                        </button>
                    )}
                </div>

                {/* Primary Group (Right) */}
                <div className="actions-group-primary">
                    {/* Convert to Workflow */}
                    <PermissionGuard can={role === 'admin' || role === 'super_admin'} fallback={null}>
                        {!task.is_micro_task && !task.has_micro_tasks && !isCompleted && (
                            <button onClick={() => setTaskToConvert(task)} className="btn-action secondary">
                                <Workflow size={18} />
                                <span className="hidden sm:inline">Converter</span>
                            </button>
                        )}
                    </PermissionGuard>

                    {/* Return Adjustment (Micro Task) */}
                    {/* 🔧 FIX: Botão deve estar visível durante pendente, em_execucao E devolvida */}
                    {task.is_micro_task && task.status !== 'bloqueada' && task.status !== 'concluida' && (
                        <button onClick={openReturnModal} className="btn-action secondary" disabled={loadingProfessionals}>
                            Solicitar Ajuste
                        </button>
                    )}

                    {/* Start Task */}
                    {task.status === 'pendente' && (
                        <button onClick={() => onUpdateStatus(task.id, task.is_micro_task ? 'em_execucao' : 'em_progresso')} className="btn-action primary">
                            Iniciar Execução
                        </button>
                    )}

                    {/* Reopen Task */}
                    {isCompleted && (
                        <button onClick={() => onUpdateStatus(task.id, 'em_progresso')} className="btn-action secondary">
                            Reabrir Tarefa
                        </button>
                    )}

                    {/* Complete Task */}
                    {(task.status === 'em_progresso' || task.status === 'em_execucao') && (
                        <button onClick={() => onUpdateStatus(task.id, 'concluida')} className="btn-action primary">
                            <CheckCircle2 size={18} />
                            Concluir Tarefa
                        </button>
                    )}

                    {/* Blocked State Feedback */}
                    {task.status === 'bloqueada' && (
                        <button disabled className="btn-action secondary" style={{ opacity: 0.7 }}>
                            <Lock size={18} />
                            Bloqueada
                        </button>
                    )}

                    {/* Returned State */}
                    {task.status === 'devolvida' && (
                        <button onClick={() => onUpdateStatus(task.id, task.is_micro_task ? 'em_execucao' : 'em_progresso')} className="btn-action primary">
                            Reiniciar Execução
                        </button>
                    )}
                </div>
            </div>

            {/* Modals */}
            {showReturnModal && (
                <ReturnReasonModal
                    isOpen={showReturnModal}
                    microTask={task}
                    professionals={professionals}
                    onClose={() => setShowReturnModal(false)}
                    onSubmit={handleReturnTask}
                />
            )}

            {showDeleteModal && (
                <ConfirmDeleteModal
                    taskTitle={task.titulo}
                    onClose={() => setShowDeleteModal(false)}
                    onConfirm={handleConfirmDelete}
                    isDeleting={isDeleting}
                />
            )}

            {taskToConvert && (
                <ConversaoWorkflowModal
                    os={taskToConvert}
                    isOpen={!!taskToConvert}
                    onClose={() => setTaskToConvert(null)}
                    onSuccess={() => {
                        setTaskToConvert(null)
                        setSelectedTask(null)
                        onRefresh()
                    }}
                />
            )}

            {showEditModal && (
                <EditTaskModal
                    task={task}
                    isOpen={showEditModal}
                    onClose={() => setShowEditModal(false)}
                    onSuccess={() => {
                        setShowEditModal(false)
                        onRefresh()
                    }}
                    currentUserId={user?.id}
                />
            )}
        </div>
    )
}

