import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { getDashboardMetrics } from '../../services/dashboardMetrics'
import { Edit2, Trash2, ClipboardList, AlertTriangle, X, ExternalLink, Folder, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import MacroTaskDetail from '../../components/MacroTaskDetail'
import EditTaskModal from '../../components/EditTaskModal'
import { useAuth } from '../../contexts/AuthContext'
import '../../styles/adminTasks.css'

function Tasks() {
    const navigate = useNavigate()
    const { user, role } = useAuth()
    const [tasks, setTasks] = useState([])
    const [professionals, setProfessionals] = useState([])
    const [departments, setDepartments] = useState([])
    const [clients, setClients] = useState([])
    const [loading, setLoading] = useState(true)
    const [fetchError, setFetchError] = useState(null)

    // Actionable metrics from centralized service (NOT status-based)
    const [actionableMetrics, setActionableMetrics] = useState({
        overdueActive: 0,      // 🔴 Ativas atrasadas
        dueToday: 0,           // ⏰ Vencem hoje
        dueIn48h: 0,           // ⚠️ Vencem em 48h
        unassigned: 0          // 👤 Sem responsável
    })

    // Pagination state
    const PAGE_SIZE = 50
    const [currentPage, setCurrentPage] = useState(0)
    const [hasMore, setHasMore] = useState(true)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [isRefreshing, setIsRefreshing] = useState(false) // C3: Desktop refresh state
    const [totalCount, setTotalCount] = useState(0)

    // Filters
    const [searchTerm, setSearchTerm] = useState('')
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
    const [statusFilter, setStatusFilter] = useState('pending')  // Padrão: mostrar apenas pendentes
    const [priorityFilter, setPriorityFilter] = useState('all')
    // const [assignedToFilter, setAssignedToFilter] = useState('all') // Removed as per request
    const [deadlineFilter, setDeadlineFilter] = useState('all')

    // Modals
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [showEditModal, setShowEditModal] = useState(false)
    const [showDetailModal, setShowDetailModal] = useState(false)
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [showCancelModal, setShowCancelModal] = useState(false)
    const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)
    const [selectedTask, setSelectedTask] = useState(null)

    // Bulk selection
    const [selectedTasks, setSelectedTasks] = useState([])

    // Workflow Editing State (Legacy removed, keeping for safety if needed internally but EditTaskModal handles it)
    const [workflowReferenceData, setWorkflowReferenceData] = useState({
        professionals: [],
        functions: []
    })

    // Form state
    const [formData, setFormData] = useState({
        titulo: '',
        descricao: '',
        cliente_id: '',
        departamento_id: '',
        assigned_to: '',
        deadline: '',
        priority: 'medium',
        status: 'pending',
        drive_link: ''
    })

    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        fetchData()
        fetchActionableMetrics()
    }, [])

    // Debounce search term
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm)
        }, 500)

        return () => {
            clearTimeout(handler)
        }
    }, [searchTerm])

    async function fetchActionableMetrics() {
        try {
            const data = await getDashboardMetrics()
            setActionableMetrics({
                overdueActive: data.overdueActive || 0,
                dueToday: data.dueToday || 0,
                dueIn48h: data.dueIn48h || 0,
                unassigned: data.unassigned || 0
            })
        } catch (error) {
            console.error('Error fetching actionable metrics:', error)
            // Metrics are non-critical, no need to show error toast
        }
    }

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(0)
        setTasks([])
        fetchData(true) // true = reset
    }, [statusFilter, priorityFilter, deadlineFilter, debouncedSearchTerm]) // Removed assignedToFilter

    // Helper: Reset all pagination-related state
    function resetPaginationState() {
        setCurrentPage(0)
        setTasks([])
        setTotalCount(0)
        setHasMore(false)
        setFetchError(null)
    }

    // Helper: Handle range errors with auto-retry logic
    function handleRangeError(reset, pageToFetch) {
        if (import.meta.env.DEV) {

        }

        resetPaginationState()
        setLoading(false)
        setIsLoadingMore(false)

        // Auto-retry with reset if this wasn't already a reset attempt
        if (!reset && pageToFetch !== 0) {
            if (import.meta.env.DEV) {

            }
            setTimeout(() => fetchData(true), 100)
        }
    }

    async function fetchData(reset = false) {
        try {
            setIsRefreshing(true) // C3: Track refresh state
            const isInitialLoad = reset || currentPage === 0
            if (isInitialLoad) {
                setLoading(true)
                setFetchError(null) // Clear previous errors
            } else {
                setIsLoadingMore(true)
            }

            // Defensive: ensure page is never negative
            const pageToFetch = Math.max(0, reset ? 0 : currentPage)
            const rangeStart = pageToFetch * PAGE_SIZE
            const rangeEnd = rangeStart + PAGE_SIZE - 1

            // Build tasks query with pagination
            let tasksQuery = supabase
                .from('tarefas')
                .select(`
                    *,
                    empresas (
                        id,
                        nome
                    ),
                    micro_tasks:tarefas_micro (
                        id,
                        status,
                        funcao,
                        profissionais!profissional_id (
                            id,
                            nome
                        )
                    )
                `, { count: 'exact' })

            // Apply filters BEFORE ordering and pagination
            // Apply filters BEFORE ordering and pagination
            if (debouncedSearchTerm) {
                // 1. Find matching companies
                const matchingClientIds = clients
                    .filter(c => c.nome.toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
                    .map(c => c.id)

                // 2. Find matching professionals
                const matchingProfIds = professionals
                    .filter(p => p.nome.toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
                    .map(p => p.id)

                // 3. Construct OR query
                const conditions = [`titulo.ilike.%${debouncedSearchTerm}%`]

                if (matchingClientIds.length > 0) {
                    conditions.push(`cliente_id.in.(${matchingClientIds.join(',')})`)
                }

                if (matchingProfIds.length > 0) {
                    conditions.push(`assigned_to.in.(${matchingProfIds.join(',')})`)
                }

                tasksQuery = tasksQuery.or(conditions.join(','))
            }

            if (statusFilter && statusFilter !== 'all') {
                if (statusFilter === 'pending') {
                    tasksQuery = tasksQuery.in('status', ['pending', 'pendente'])
                } else if (statusFilter === 'in_progress') {
                    tasksQuery = tasksQuery.in('status', ['in_progress', 'em_progresso', 'em progresso'])
                } else if (statusFilter === 'completed') {
                    tasksQuery = tasksQuery.in('status', ['completed', 'concluída', 'concluida'])
                } else if (statusFilter === 'overdue') {
                    // FIX: Overdue is a calculated state (Deadline < Now AND Status != Completed)
                    // It is NOT a stored status in the DB usually.
                    tasksQuery = tasksQuery
                        .lt('deadline', new Date().toISOString())
                        .not('status', 'in', '("completed","concluída","concluida","cancelada")')
                } else if (statusFilter === 'cancelada') {
                    tasksQuery = tasksQuery.eq('status', 'cancelada')
                } else {
                    tasksQuery = tasksQuery.eq('status', statusFilter)
                }
            }

            if (priorityFilter && priorityFilter !== 'all') {
                tasksQuery = tasksQuery.eq('priority', priorityFilter)
            }

            // Removed assignedToFilter logic
            // if (assignedToFilter && assignedToFilter !== 'all') {
            //    tasksQuery = tasksQuery.eq('assigned_to', assignedToFilter)
            // }

            // Deadline filters
            if (deadlineFilter === 'overdue') {
                tasksQuery = tasksQuery
                    .lt('deadline', new Date().toISOString())
                    .neq('status', 'completed')
            } else if (deadlineFilter === 'today') {
                const today = new Date()
                const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate())
                const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
                tasksQuery = tasksQuery
                    .gte('deadline', startOfDay.toISOString())
                    .lt('deadline', endOfDay.toISOString())
            } else if (deadlineFilter === 'week') {
                const now = new Date()
                const weekFromNow = new Date(now)
                weekFromNow.setDate(weekFromNow.getDate() + 7)
                tasksQuery = tasksQuery
                    .gte('deadline', now.toISOString())
                    .lte('deadline', weekFromNow.toISOString())
            }

            tasksQuery = tasksQuery
                .order('deadline', { ascending: true, nullsLast: true })  // C1: nullsLast ensures tasks without deadline appear at end
                .range(rangeStart, rangeEnd)

            // Reference data (professionals, departments, clients) - load once
            const shouldLoadReferenceData = isInitialLoad || professionals.length === 0

            const queries = [tasksQuery]

            if (shouldLoadReferenceData) {
                queries.push(
                    supabase
                        .from('profissionais')
                        .select('id, nome')
                        .eq('ativo', true)
                        .order('nome'),
                    supabase
                        .from('areas')
                        .select('id, nome')
                        .eq('ativo', true)
                        .order('nome'),
                    supabase
                        .from('empresas')
                        .select('id, nome')
                        .eq('empresa_tipo', 'operacional')
                        .order('nome')
                )
            }

            const results = await Promise.all(queries)
            const tasksResult = results[0]

            // Handle 416/418 Range Not Satisfiable error gracefully
            // Handle 416/418 Range Not Satisfiable error gracefully
            if (tasksResult.error) {
                const errorCode = tasksResult.error.code
                const errorMsg = tasksResult.error.message || ''
                // FIX: Check status on the response object first (tasksResult.status), as tasksResult.error.status might be undefined
                const errorStatus = tasksResult.status || tasksResult.error.status

                // Check for range errors (416 or 418 status codes, or PGRST103 code)
                if (
                    errorCode === 'PGRST103' ||
                    errorMsg.includes('416') ||
                    errorMsg.includes('418') ||
                    errorStatus === 416 ||
                    errorStatus === 418 ||
                    errorMsg.toLowerCase().includes('range not satisfiable')
                ) {
                    console.warn(`[Tasks] Range error (416/PGRST103) at page ${pageToFetch}. Auto-correcting to page 0.`)
                    // CRITICAL FIX: Reset explicitly to page 0 to recover from "Range Not Satisfiable"
                    resetPaginationState()
                    // Re-fetch immediately at page 0 to restore UI
                    if (!reset && pageToFetch !== 0) {
                        setTimeout(() => fetchData(true), 50)
                    }
                    return
                }

                // Real error - not a range issue
                throw tasksResult.error
            }

            const newTasks = tasksResult.data || []
            const count = tasksResult.count || 0

            // Handle empty results gracefully - THIS IS NOT AN ERROR
            if (count === 0 || newTasks.length === 0) {
                setTasks([])
                setTotalCount(0)
                setHasMore(false)
                setFetchError(null) // Explicitly clear any error state
                return
            }

            setTotalCount(count)
            setHasMore(rangeEnd < count - 1)

            if (reset) {
                setTasks(newTasks)
                setCurrentPage(1)
            } else {
                // Prevent duplicate tasks by filtering out IDs that already exist
                setTasks(prev => {
                    const existingIds = new Set(prev.map(t => t.id))
                    const uniqueNewTasks = newTasks.filter(t => !existingIds.has(t.id))
                    return [...prev, ...uniqueNewTasks]
                })
                setCurrentPage(prev => prev + 1)
            }

            // Update reference data if loaded
            if (shouldLoadReferenceData && results.length > 1) {
                const [, profsResult, deptsResult, clientsResult] = results

                if (profsResult?.error) throw profsResult.error
                if (deptsResult?.error) throw deptsResult.error
                if (clientsResult?.error) throw clientsResult.error

                setProfessionals(profsResult?.data || [])
                setDepartments(deptsResult?.data || [])
                setClients(clientsResult?.data || [])
            }

        } catch (error) {
            console.error('Error fetching data:', error)
            const errorMessage = error?.message || error?.error_description || 'Erro desconhecido ao buscar dados'
            setFetchError(errorMessage)
            toast.error('Erro ao carregar dados. Por favor, recarregue a página.')
        } finally {
            setLoading(false)
            setIsLoadingMore(false)
            setIsRefreshing(false) // C3: Clear refresh state
        }
    }

    // C3: Desktop manual refresh handler
    async function handleManualRefresh() {
        await fetchData(true) // reset=true to start from page 1
    }

    function loadMore() {
        if (!isLoadingMore && hasMore) {
            fetchData(false)
        }
    }



    function resetForm() {
        setFormData({
            titulo: '',
            descricao: '',
            cliente_id: '',
            departamento_id: '',
            assigned_to: '',
            deadline: '',
            priority: 'medium',
            status: 'pending',
            drive_link: ''
        })
    }

    function handleOpenCreateModal() {
        navigate('/admin/tasks/new')
    }

    function handleOpenEditModal(task) {
        setSelectedTask(task)
        setShowEditModal(true)
    }

    async function loadWorkflowReferenceData(clientId) {
        if (!clientId) return
        setLoadingWorkflowData(true)
        try {
            const { data, error } = await supabase
                .from('empresa_profissionais')
                .select(`
                    profissional_id,
                    funcao,
                    profissionais!inner (
                        id,
                        nome
                    )
                `)
                .eq('empresa_id', clientId)
                .eq('ativo', true)

            if (error) throw error

            const professionals = data || []
            const functions = [...new Set(professionals.map(p => p.funcao))]

            setWorkflowReferenceData({
                professionals,
                functions
            })
        } catch (error) {
            console.error('Error loading workflow data:', error)
            toast.error('Erro ao carregar dados do workflow')
        } finally {
            setLoadingWorkflowData(false)
        }
    }


    async function refreshTaskDetails(taskId) {
        if (!taskId) return null

        try {
            const { data, error } = await supabase
                .from('tarefas')
                .select(`
                    *,
                    micro_tasks:tarefas_micro (
                        id,
                        status,
                        funcao,
                        created_at,
                        updated_at,
                        profissionais!profissional_id (
                            id,
                            nome
                        )
                    )
                `)
                .eq('id', taskId)
                .single() // Return object not array

            if (error) throw error

            // Sort micro tasks by created_at or id (assuming insertion order)
            if (data.micro_tasks) {
                data.micro_tasks.sort((a, b) => a.id - b.id)
            }

            return data
        } catch (error) {
            console.error('Error refreshing task details:', error)
            return null
        }
    }

    async function handleOpenDetailModal(task) {
        // Show cached data first while loading fresh
        setSelectedTask(task)
        setShowDetailModal(true)

        // Fetch fresh data
        const freshData = await refreshTaskDetails(task.id)
        if (freshData) {
            setSelectedTask(freshData)

            // Also update the list state to reflect changes without full reload
            setTasks(prev => prev.map(t => t.id === freshData.id ? freshData : t))
        }
    }

    function handleOpenDeleteModal(task) {
        setSelectedTask(task)
        setShowDeleteModal(true)
    }

    function handleOpenBulkDeleteModal() {
        setShowBulkDeleteModal(true)
    }

    async function handleCreateTask(e) {
        e.preventDefault()

        if (!formData.titulo.trim()) {
            toast.error('Por favor, insira um título para a tarefa')
            return
        }

        if (!formData.deadline) {
            toast.error('Por favor, defina um prazo para a tarefa')
            return
        }

        setSubmitting(true)

        try {
            const taskData = {
                titulo: formData.titulo.trim(),
                descricao: formData.descricao.trim() || null,
                cliente_id: formData.cliente_id || null,
                departamento_id: formData.departamento_id || null,
                assigned_to: formData.assigned_to || null,
                deadline: formData.deadline,
                priority: formData.priority,
                status: formData.status,
                drive_link: formData.drive_link.trim() || null
            }

            const { error } = await supabase
                .from('tarefas')
                .insert([taskData])

            if (error) throw error

            toast.success('Tarefa criada com sucesso!')
            setShowCreateModal(false)
            resetForm()
            await fetchData()
        } catch (error) {
            console.error('Error creating task:', error)
            toast.error('Erro ao criar tarefa. Tente novamente.')
        } finally {
            setSubmitting(false)
        }
    }


    async function handleConfirmDelete() {
        if (!selectedTask) return

        setSubmitting(true)

        try {
            const { error } = await supabase
                .from('tarefas')
                .delete()
                .eq('id', selectedTask.id)

            if (error) throw error

            toast.success('Tarefa excluída com sucesso!')
            setShowDeleteModal(false)
            setSelectedTask(null)
            await fetchData()
        } catch (error) {
            console.error('Error deleting task:', error)
            toast.error('Erro ao excluir tarefa. Tente novamente.')
        } finally {
            setSubmitting(false)
        }
    }

    function handleCancelRequest() {
        // Close edit modal and open cancel confirmation modal
        setShowEditModal(false)
        setShowCancelModal(true)
    }

    async function handleConfirmCancel() {
        if (!selectedTask) return

        setSubmitting(true)

        try {
            const { error } = await supabase
                .from('tarefas')
                .update({ status: 'cancelada' })
                .eq('id', selectedTask.id)

            if (error) throw error

            toast.success('OS cancelada com sucesso!')
            setShowCancelModal(false)
            setSelectedTask(null)
            await fetchData()
        } catch (error) {
            console.error('Error canceling OS:', error)
            toast.error('Erro ao cancelar OS. Tente novamente.')
        } finally {
            setSubmitting(false)
        }
    }

    async function handleReopen() {
        if (!selectedTask) return

        setSubmitting(true)

        try {
            const { error } = await supabase
                .from('tarefas')
                .update({ status: 'pending' })
                .eq('id', selectedTask.id)

            if (error) throw error

            toast.success('OS reaberta com sucesso!')
            setShowDetailModal(false)
            setSelectedTask(null)
            await fetchData()
        } catch (error) {
            console.error('Error reopening OS:', error)
            toast.error('Erro ao reabrir OS. Tente novamente.')
        } finally {
            setSubmitting(false)
        }
    }

    async function handleConfirmBulkDelete() {
        if (selectedTasks.length === 0) return

        setSubmitting(true)

        try {
            const { error } = await supabase
                .from('tarefas')
                .delete()
                .in('id', selectedTasks)

            if (error) throw error

            toast.success(`${selectedTasks.length} ${selectedTasks.length === 1 ? 'tarefa excluída' : 'tarefas excluídas'} com sucesso!`)
            setShowBulkDeleteModal(false)
            setSelectedTasks([])
            await fetchData()
        } catch (error) {
            console.error('Error deleting tasks:', error)
            toast.error('Erro ao excluir tarefas. Tente novamente.')
        } finally {
            setSubmitting(false)
        }
    }

    function handleSelectTask(taskId) {
        setSelectedTasks(prev => {
            if (prev.includes(taskId)) {
                return prev.filter(id => id !== taskId)
            } else {
                return [...prev, taskId]
            }
        })
    }

    function handleSelectAll() {
        const taskIds = tasks.map(task => task.id)
        if (selectedTasks.length === taskIds.length) {
            setSelectedTasks([])
        } else {
            setSelectedTasks(taskIds)
        }
    }

    function handleCancelSelection() {
        setSelectedTasks([])
    }

    function sortTasksByPriority(tasks) {
        return [...tasks].sort((a, b) => {
            // 1️⃣ Não concluídas primeiro
            const aCompleted = ['completed', 'concluída', 'concluida'].includes(a.status?.toLowerCase())
            const bCompleted = ['completed', 'concluída', 'concluida'].includes(b.status?.toLowerCase())

            if (aCompleted !== bCompleted) {
                return aCompleted ? 1 : -1
            }

            // 2️⃣ Prazo mais próximo
            if (!a.deadline && !b.deadline) return 0
            if (!a.deadline) return 1
            if (!b.deadline) return -1

            const deadlineDiff = new Date(a.deadline) - new Date(b.deadline)
            if (deadlineDiff !== 0) return deadlineDiff

            // 3️⃣ Desempate: Prioridade (urgente → alta → média → baixa)
            const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 }
            const aPriority = priorityOrder[a.priority] ?? 4
            const bPriority = priorityOrder[b.priority] ?? 4

            if (aPriority !== bPriority) {
                return aPriority - bPriority
            }

            // 4️⃣ Desempate final: Mais recente primeiro (created_at DESC)
            return new Date(b.created_at) - new Date(a.created_at)
        })
    }

    function getFilteredTasks() {
        const filtered = tasks.filter(task => {
            const matchesSearch = task.titulo.toLowerCase().includes(searchTerm.toLowerCase())

            // Status filter com normalização
            const matchesStatus = statusFilter === 'all' || (() => {
                const normalizedTask = task.status?.toLowerCase()
                const normalizedFilter = statusFilter.toLowerCase()

                // Map de equivalências
                const statusMap = {
                    'completed': ['completed', 'concluída', 'concluida'],
                    'in_progress': ['in_progress', 'em_progresso', 'em progresso'],
                    'pending': ['pending', 'pendente'],
                    'overdue': ['overdue', 'atrasada']
                }

                const validStatuses = statusMap[normalizedFilter] || [normalizedFilter]
                return validStatuses.includes(normalizedTask)
            })()

            const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter
            const matchesAssignedTo = assignedToFilter === 'all' || task.assigned_to === assignedToFilter

            // Deadline filter logic
            let matchesDeadline = true
            if (deadlineFilter !== 'all') {
                const now = new Date()
                const deadline = new Date(task.deadline)
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
                const taskDate = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate())

                if (deadlineFilter === 'overdue') {
                    matchesDeadline = task.status !== 'completed' && deadline < now
                } else if (deadlineFilter === 'today') {
                    matchesDeadline = taskDate.getTime() === today.getTime()
                } else if (deadlineFilter === 'week') {
                    const weekFromNow = new Date(now)
                    weekFromNow.setDate(weekFromNow.getDate() + 7)
                    matchesDeadline = deadline >= now && deadline <= weekFromNow
                }
            }

            return matchesSearch && matchesStatus && matchesPriority && matchesAssignedTo && matchesDeadline
        })

        // Aplicar ordenação inteligente
        return sortTasksByPriority(filtered)
    }

    function getStatusBadgeClass(status) {
        // Normalize status to lowercase
        const normalized = status ? status.toLowerCase() : ''

        if (normalized === 'completed' || normalized === 'concluida' || normalized === 'concluída') return 'badge-success'
        if (normalized === 'in_progress' || normalized === 'em_progresso' || normalized === 'em progresso') return 'badge-primary'
        if (normalized === 'overdue' || normalized === 'atrasada') return 'badge-danger'
        // Use subtle badge for pending
        if (normalized === 'pending' || normalized === 'pendente') return 'badge-pending-subtle'

        return 'badge-neutral'
    }

    function getStatusLabel(status) {
        switch (status) {
            case 'completed': return 'Concluída'
            case 'in_progress': return 'Em Progresso'
            case 'overdue': return 'Atrasada'
            case 'pending': return 'Pendente'
            default: return status
        }
    }

    function getPriorityBadgeClass(priority) {
        switch (priority) {
            case 'urgent':
                return 'badge-urgent'
            case 'high':
                return 'badge-high'
            case 'medium': // Keeping medium as warning/yellow-orange or distinctive
                return 'badge-medium'
            case 'low':
                return 'badge-low'
            default:
                return 'badge-neutral'
        }
    }

    function getPriorityLabel(priority) {
        switch (priority) {
            case 'urgent': return 'Urgente'
            case 'high': return 'Alta'
            case 'medium': return 'Média'
            case 'low': return 'Baixa'
            default: return priority
        }
    }

    function getAssignedToName(assignedToId) {
        const prof = professionals.find(p => p.id === assignedToId)
        return prof ? prof.nome : 'Não atribuída'
    }


    function calculateProgress(task) {
        if (!task.micro_tasks || task.micro_tasks.length === 0) {
            const normalizedStatus = task.status ? task.status.toLowerCase() : ''
            return (normalizedStatus === 'completed' || normalizedStatus === 'concluida' || normalizedStatus === 'concluída') ? 100 : null
        }

        const total = task.micro_tasks.length
        const completed = task.micro_tasks.filter(mt => {
            const s = mt.status ? mt.status.toLowerCase() : ''
            return s === 'completed' || s === 'concluida' || s === 'concluída'
        }).length

        return Math.round((completed / total) * 100)
    }

    function isOverdue(task) {
        if (!task.deadline) return false
        const normalizedStatus = task.status ? task.status.toLowerCase() : ''
        if (normalizedStatus === 'completed' || normalizedStatus === 'concluída') return false

        const deadlineDate = new Date(task.deadline)
        const now = new Date()
        return deadlineDate < now
    }

    function getFilterLabel() {
        const filters = []

        if (statusFilter && statusFilter !== 'all') {
            const statusLabels = {
                'pending': 'Pendentes',
                'in_progress': 'Em Progresso',
                'completed': 'Concluídas',
                'overdue': 'Atrasadas',
                'cancelada': 'Canceladas'
            }
            filters.push(statusLabels[statusFilter] || statusFilter)
        }

        if (searchTerm) {
            filters.push(`Busca: "${searchTerm}"`)
        }

        if (priorityFilter && priorityFilter !== 'all') {
            filters.push(`Prioridade: ${priorityFilter}`)
        }

        if (deadlineFilter && deadlineFilter !== 'all') {
            filters.push(`Prazo: ${deadlineFilter}`)
        }

        return filters.length > 0 ? filters.join(' + ') : 'Todas as tarefas'
    }

    // Tasks are already filtered server-side
    const allFilteredSelected = tasks.length > 0 && selectedTasks.length === tasks.length



    if (fetchError) {
        return (
            <div className="p-8">
                <div className="dashboard-header">
                    <h2>Gerenciamento de Tarefas</h2>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-6 flex flex-col items-center justify-center gap-4">
                    <AlertTriangle size={48} className="text-red-500" />
                    <h3 className="text-lg font-semibold text-red-700">Erro ao carregar dados</h3>
                    <p className="text-red-600 bg-white p-4 rounded border border-red-100 font-mono text-sm">
                        {fetchError}
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="btn btn-primary"
                    >
                        Tentar Novamente
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in">
            {/* Actionable Metrics Cards */}
            <div className="admin-tasks-section-spacing">
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <div className="card metric-card metric-card-small metric-card-danger-bg">
                        <h3 className="metric-label">Ativas Atrasadas</h3>
                        <p className="metric-value">{actionableMetrics.overdueActive}</p>
                    </div>
                    <div className="card metric-card metric-card-small" style={{ background: 'linear-gradient(135deg, #fefce8 0%, #fef3c7 100%)', borderColor: '#fde68a' }}>
                        <h3 className="metric-label">Vencem Hoje</h3>
                        <p className="metric-value">{actionableMetrics.dueToday}</p>
                    </div>
                    <div className="card metric-card metric-card-small" style={{ background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)', borderColor: '#fed7aa' }}>
                        <h3 className="metric-label">Vencem em 48h</h3>
                        <p className="metric-value">{actionableMetrics.dueIn48h}</p>
                    </div>
                    <div className="card metric-card metric-card-small metric-card-neutral-bg">
                        <h3 className="metric-label">Sem Responsável</h3>
                        <p className="metric-value">{actionableMetrics.unassigned}</p>
                    </div>
                </div>
            </div>



            {/* Filters */}
            <div className="tool-bar admin-tasks-section-spacing">
                <div className="tool-bar-header">
                    <span className="tool-bar-title">Filtros e Busca</span>
                </div>

                <div className="tool-bar-filters">
                    <div className="input-group admin-tasks-filter-group">
                        <label htmlFor="search">Buscar</label>
                        <input
                            id="search"
                            type="text"
                            className="input"
                            placeholder="Buscar por título..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="input-group admin-tasks-filter-group">
                        <label htmlFor="status">Status</label>
                        <select
                            id="status"
                            className="input"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="all">Todos</option>
                            <option value="pending">Pendente</option>
                            <option value="in_progress">Em Progresso</option>
                            <option value="completed">Concluída</option>
                            <option value="overdue">Atrasada</option>
                            <option value="cancelada">Canceladas</option>
                        </select>
                    </div>

                    <div className="input-group admin-tasks-filter-group">
                        <label htmlFor="priority">Prioridade</label>
                        <select
                            id="priority"
                            className="input"
                            value={priorityFilter}
                            onChange={(e) => setPriorityFilter(e.target.value)}
                        >
                            <option value="all">Todas</option>
                            <option value="low">Baixa</option>
                            <option value="medium">Média</option>
                            <option value="high">Alta</option>
                            <option value="urgent">Urgente</option>
                        </select>
                    </div>

                    {/* Assigned To Filter Removed */}

                    <div className="input-group admin-tasks-filter-group">
                        <label htmlFor="deadline">Prazo</label>
                        <select
                            id="deadline"
                            className="input"
                            value={deadlineFilter}
                            onChange={(e) => setDeadlineFilter(e.target.value)}
                        >
                            <option value="all">Todas</option>
                            <option value="overdue">Atrasadas</option>
                            <option value="today">Hoje</option>
                            <option value="week">Esta Semana</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="card admin-tasks-table-card admin-tasks-section-spacing">
                <div className="admin-tasks-table-header">
                    <h3 className="admin-tasks-count-title">
                        {totalCount > 0 ? `${totalCount} ${totalCount === 1 ? 'tarefa' : 'tarefas'} no total` : 'Sem tarefas'}
                    </h3>
                </div>

                {loading ? (
                    <div className="p-12 flex flex-col justify-center items-center gap-4">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
                        <p className="text-slate-500 font-medium animate-pulse">Carregando tarefas...</p>
                    </div>
                ) : tasks.length === 0 ? (
                    <div className="empty-state">
                        <span className="admin-tasks-empty-icon">
                            <ClipboardList size={64} className="text-slate-300" strokeWidth={1} />
                        </span>
                        <p className="empty-text">
                            {searchTerm || statusFilter !== 'all' || priorityFilter !== 'all' || deadlineFilter !== 'all'
                                ? 'Nenhuma tarefa encontrada com os filtros aplicados.'
                                : 'Nenhuma tarefa em andamento no momento.'}
                        </p>
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th className="admin-tasks-checkbox-cell">
                                        <input
                                            type="checkbox"
                                            className="admin-tasks-checkbox"
                                            checked={allFilteredSelected}
                                            onChange={handleSelectAll}
                                            title={allFilteredSelected ? "Desmarcar todas" : "Selecionar todas"}
                                        />
                                    </th>
                                    <th>Título</th>
                                    <th>Cliente</th>
                                    <th>Atribuída a</th>
                                    <th>Prazo</th>
                                    <th>Status</th>
                                    <th>Prioridade</th>
                                    <th className="admin-tasks-actions-cell">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tasks.map(task => {
                                    const progress = calculateProgress(task)
                                    const overdue = isOverdue(task)
                                    const isCritical = overdue && (progress === null || progress < 30)

                                    return (
                                        <tr key={task.id} className={isCritical ? 'task-row-critical' : ''}>
                                            <td className="admin-tasks-checkbox-cell">
                                                <input
                                                    type="checkbox"
                                                    className="admin-tasks-checkbox"
                                                    checked={selectedTasks.includes(task.id)}
                                                    onChange={() => handleSelectTask(task.id)}
                                                />
                                            </td>
                                            <td>
                                                <div className="flex flex-col gap-1">
                                                    <button
                                                        onClick={() => handleOpenDetailModal(task)}
                                                        className="admin-tasks-title-button"
                                                    >
                                                        {task.titulo}
                                                    </button>

                                                </div>
                                            </td>
                                            <td>
                                                {task.empresas?.nome || <span className="text-slate-400 italic font-normal text-sm">Sem cliente</span>}
                                            </td>
                                            <td>
                                                {task.micro_tasks && task.micro_tasks.length > 0 ? (
                                                    <span className="badge badge-neutral" title="Tarefa Macro com múltiplas etapas">
                                                        Workflow ({task.micro_tasks.length})
                                                    </span>
                                                ) : (
                                                    professionals.find(p => p.id === task.assigned_to)?.nome || 'Não atribuída'
                                                )}
                                            </td>

                                            <td>
                                                <div className="flex items-center gap-1">
                                                    {isOverdue(task) && (
                                                        <AlertTriangle size={13} className="text-overdue overdue-icon" />
                                                    )}
                                                    <span className={isOverdue(task) ? 'text-overdue-muted font-medium' : ''}>
                                                        {new Date(task.deadline).toLocaleDateString()}
                                                    </span>
                                                </div>
                                            </td>
                                            <td>
                                                <span className={`badge ${getStatusBadgeClass(task.status)}`}>
                                                    {getStatusLabel(task.status)}
                                                </span>
                                            </td>
                                            <td>
                                                <span className={`badge ${getPriorityBadgeClass(task.priority)}`}>
                                                    {getPriorityLabel(task.priority)}
                                                </span>
                                            </td>
                                            <td className="admin-tasks-actions-cell">
                                                <div className="admin-tasks-actions-container">
                                                    {task.created_by === user?.id && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleOpenEditModal(task); }}
                                                            className="btn-icon"
                                                            title="Editar OS"
                                                        >
                                                            <Edit2 size={18} />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleOpenDeleteModal(task)}
                                                        className="btn-icon admin-tasks-delete-button"
                                                        title="Excluir"
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>

                        {/* Pagination Info and Load More Button */}
                        <div style={{
                            padding: '20px',
                            borderTop: '1px solid #e2e8f0',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '12px'
                        }}>
                            <p style={{
                                fontSize: '14px',
                                color: '#64748b',
                                margin: 0
                            }}>
                                Mostrando {tasks.length} de {totalCount} tarefas
                            </p>

                            {hasMore && (
                                <button
                                    onClick={loadMore}
                                    disabled={isLoadingMore}
                                    className="btn btn-secondary"
                                    style={{
                                        minWidth: '200px'
                                    }}
                                >
                                    {isLoadingMore ? (
                                        <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900" style={{ display: 'inline-block', marginRight: '8px' }}></div>
                                            Carregando...
                                        </>
                                    ) : (
                                        `Carregar Mais (${Math.min(PAGE_SIZE, totalCount - tasks.length)} itens)`
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Bulk Actions Bar */}
            {selectedTasks.length > 0 && (
                <div className="admin-tasks-bulk-actions-bar">
                    <p className="admin-tasks-bulk-actions-text">
                        {selectedTasks.length} {selectedTasks.length === 1 ? 'tarefa selecionada' : 'tarefas selecionadas'}
                    </p>
                    <div className="admin-tasks-bulk-actions-buttons">
                        <button onClick={handleCancelSelection} className="btn btn-secondary">
                            Cancelar
                        </button>
                        <button onClick={handleOpenBulkDeleteModal} className="btn btn-primary">
                            <Trash2 size={18} className="admin-tasks-icon-spacing" />
                            Excluir Selecionadas
                        </button>
                    </div>
                </div>
            )}

            {/* Create Modal */}
            {showCreateModal && (
                <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Nova Tarefa</h3>
                            <button className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleCreateTask}>
                            <div className="modal-body">
                                <div className="input-group">
                                    <label htmlFor="titulo">Título *</label>
                                    <input
                                        id="titulo"
                                        type="text"
                                        className="input"
                                        value={formData.titulo}
                                        onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
                                        placeholder="Ex: Criar apresentação para cliente"
                                        required
                                    />
                                </div>

                                <div className="input-group">
                                    <label htmlFor="descricao">Descrição</label>
                                    <textarea
                                        id="descricao"
                                        className="input"
                                        value={formData.descricao}
                                        onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                                        placeholder="Detalhes adicionais sobre a tarefa..."
                                        rows="3"
                                    />
                                </div>

                                <div className="input-group">
                                    <label htmlFor="cliente">Cliente</label>
                                    <select
                                        id="cliente"
                                        className="input"
                                        value={formData.cliente_id}
                                        onChange={(e) => setFormData({ ...formData, cliente_id: e.target.value })}
                                    >
                                        <option value="">-- Selecione --</option>
                                        {clients.map(client => (
                                            <option key={client.id} value={client.id}>{client.nome}</option>
                                        ))}
                                    </select>
                                </div>



                                <div className="input-group">
                                    <label htmlFor="assigned_to">Atribuir a</label>
                                    <select
                                        id="assigned_to"
                                        className="input"
                                        value={formData.assigned_to}
                                        onChange={(e) => setFormData({ ...formData, assigned_to: e.target.value })}
                                    >
                                        <option value="">-- Selecione --</option>
                                        {professionals.map(prof => (
                                            <option key={prof.id} value={prof.id}>{prof.nome}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="input-group">
                                    <label htmlFor="deadline">Prazo *</label>
                                    <input
                                        id="deadline"
                                        type="datetime-local"
                                        className="input"
                                        value={formData.deadline}
                                        onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="input-group">
                                    <label htmlFor="priority">Prioridade</label>
                                    <select
                                        id="priority"
                                        className="input"
                                        value={formData.priority}
                                        onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                                    >
                                        <option value="low">Baixa</option>
                                        <option value="medium">Média</option>
                                        <option value="high">Alta</option>
                                        <option value="urgent">Urgente</option>
                                    </select>
                                </div>

                                <div className="input-group">
                                    <label htmlFor="drive_link">Link do Drive</label>
                                    <input
                                        id="drive_link"
                                        type="url"
                                        className="input"
                                        value={formData.drive_link}
                                        onChange={(e) => setFormData({ ...formData, drive_link: e.target.value })}
                                        placeholder="https://drive.google.com/..."
                                    />
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="btn btn-secondary"
                                    disabled={submitting}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={submitting}
                                >
                                    {submitting ? 'Criando...' : 'Criar Tarefa'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Modal (New Component) */}
            {showEditModal && selectedTask && (
                <EditTaskModal
                    task={selectedTask}
                    isOpen={showEditModal}
                    onClose={() => setShowEditModal(false)}
                    onSuccess={() => {
                        setShowEditModal(false)
                        fetchData()
                    }}
                    currentUserId={user?.id}
                    onCancelRequest={handleCancelRequest}
                />
            )}

            {/* Detail Modal - Using MacroTaskDetail Component */}
            {showDetailModal && selectedTask && (
                <div className="modal-backdrop" onClick={() => {
                    setShowDetailModal(false)
                    setSelectedTask(null)
                    fetchData()
                }}>
                    <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
                        <MacroTaskDetail
                            taskId={selectedTask.id}
                            isModal={true}
                            onBack={() => {
                                setShowDetailModal(false)
                                setSelectedTask(null)
                                fetchData() // Refresh to show any changes
                            }}
                            onEdit={
                                (user?.id === selectedTask.created_by || role === 'admin' || role === 'super_admin')
                                    ? () => {
                                        setShowDetailModal(false)
                                        setShowEditModal(true)
                                    }
                                    : undefined
                            }
                            onDelete={
                                (user?.id === selectedTask.created_by || role === 'admin' || role === 'super_admin')
                                    ? () => {
                                        setShowDetailModal(false)
                                        setShowDeleteModal(true)
                                    }
                                    : undefined
                            }
                            onReopen={
                                (role === 'admin' || role === 'super_admin')
                                    ? async () => {
                                        try {
                                            await handleReopenTask(selectedTask)
                                            setShowDetailModal(false)
                                            setSelectedTask(null)
                                            fetchData()
                                        } catch (error) {
                                            console.error('Error reopening task:', error)
                                        }
                                    }
                                    : undefined
                            }
                        />
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteModal && selectedTask && (
                <div className="modal-backdrop" onClick={() => setShowDeleteModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-body">
                            <div className="admin-tasks-delete-modal-icon">
                                <AlertTriangle size={24} />
                            </div>
                            <h3 className="admin-tasks-delete-modal-title">Excluir Tarefa</h3>
                            <p className="admin-tasks-delete-modal-message">
                                Tem certeza que deseja excluir a tarefa{' '}
                                <span className="admin-tasks-delete-modal-task-name">"{selectedTask.titulo}"</span>?
                            </p>
                            <p className="admin-tasks-delete-modal-warning">
                                ⚠️ Esta ação não pode ser desfeita.
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button
                                onClick={() => setShowDeleteModal(false)}
                                className="btn btn-secondary"
                                disabled={submitting}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmDelete}
                                className="btn btn-primary"
                                disabled={submitting}
                            >
                                {submitting ? 'Excluindo...' : 'Excluir'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cancel OS Confirmation Modal */}
            {showCancelModal && selectedTask && (
                <div className="modal-backdrop" onClick={() => setShowCancelModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-body">
                            <div className="admin-tasks-delete-modal-icon">
                                <AlertTriangle size={24} />
                            </div>
                            <h3 className="admin-tasks-delete-modal-title">Cancelar Ordem de Serviço</h3>
                            <p className="admin-tasks-delete-modal-message">
                                Tem certeza que deseja cancelar a OS{' '}
                                <span className="admin-tasks-delete-modal-task-name">"{selectedTask.titulo}"</span>?
                            </p>
                            <p className="admin-tasks-delete-modal-warning">
                                ⚠️ Esta ação não pode ser desfeita. A OS será movida para "Canceladas".
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button
                                onClick={() => setShowCancelModal(false)}
                                className="btn btn-secondary"
                                disabled={submitting}
                            >
                                Voltar
                            </button>
                            <button
                                onClick={handleConfirmCancel}
                                className="btn btn-primary"
                                disabled={submitting}
                            >
                                {submitting ? 'Cancelando...' : 'Confirmar Cancelamento'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Delete Confirmation Modal */}
            {showBulkDeleteModal && (
                <div className="modal-backdrop" onClick={() => setShowBulkDeleteModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-body">
                            <div className="admin-tasks-delete-modal-icon">
                                <AlertTriangle size={24} />
                            </div>
                            <h3 className="admin-tasks-delete-modal-title">Excluir Tarefas</h3>
                            <p className="admin-tasks-delete-modal-message">
                                Tem certeza que deseja excluir{' '}
                                <span className="admin-tasks-delete-modal-task-name">
                                    {selectedTasks.length} {selectedTasks.length === 1 ? 'tarefa selecionada' : 'tarefas selecionadas'}
                                </span>?
                            </p>
                            <p className="admin-tasks-delete-modal-warning">
                                ⚠️ Esta ação não pode ser desfeita.
                            </p>
                        </div>
                        <div className="modal-footer">
                            <button
                                onClick={() => setShowBulkDeleteModal(false)}
                                className="btn btn-secondary"
                                disabled={submitting}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmBulkDelete}
                                className="btn btn-primary"
                                disabled={submitting}
                            >
                                {submitting ? 'Excluindo...' : 'Excluir Todas'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Tasks

