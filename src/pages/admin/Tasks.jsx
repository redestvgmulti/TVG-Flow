import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { Edit2, Trash2, ClipboardList, AlertTriangle, X, ExternalLink, Folder } from 'lucide-react'
import { toast } from 'sonner'
import MacroTaskDetail from '../../components/MacroTaskDetail'
import '../../styles/adminTasks.css'

function Tasks() {
    const navigate = useNavigate()
    const [tasks, setTasks] = useState([])
    const [professionals, setProfessionals] = useState([])
    const [departments, setDepartments] = useState([])
    const [clients, setClients] = useState([])
    const [loading, setLoading] = useState(true)
    const [fetchError, setFetchError] = useState(null)

    // Filters
    const [searchTerm, setSearchTerm] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [priorityFilter, setPriorityFilter] = useState('all')
    const [assignedToFilter, setAssignedToFilter] = useState('all')
    const [deadlineFilter, setDeadlineFilter] = useState('all')

    // Modals
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [showEditModal, setShowEditModal] = useState(false)
    const [showDetailModal, setShowDetailModal] = useState(false)
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)
    const [selectedTask, setSelectedTask] = useState(null)

    // Bulk selection
    const [selectedTasks, setSelectedTasks] = useState([])

    // Workflow Editing State
    const [editingMicroTasks, setEditingMicroTasks] = useState([])
    const [workflowReferenceData, setWorkflowReferenceData] = useState({
        professionals: [],
        functions: []
    })
    const [loadingWorkflowData, setLoadingWorkflowData] = useState(false)

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
    }, [])

    async function fetchData() {
        try {
            setLoading(true)

            const [tasksResult, profsResult, deptsResult, clientsResult] = await Promise.all([
                supabase
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
                            profissional:profissionais (
                                id,
                                nome
                            )
                        )
                    `)
                    .order('created_at', { ascending: false }),
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
            ])

            if (tasksResult.error) throw tasksResult.error
            if (profsResult.error) throw profsResult.error
            if (deptsResult.error) throw deptsResult.error
            if (clientsResult.error) throw clientsResult.error

            setTasks(tasksResult.data || [])
            setProfessionals(profsResult.data || [])
            setDepartments(deptsResult.data || [])
            setClients(clientsResult.data || [])
        } catch (error) {
            console.error('Error fetching data:', error)
            setFetchError(error.message || 'Erro desconhecido ao buscar dados')
            toast.error('Erro ao carregar dados. Por favor, recarregue a página.')
        } finally {
            setLoading(false)
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
        setFormData({
            titulo: task.titulo || '',
            descricao: task.descricao || '',
            cliente_id: task.cliente_id || '',
            departamento_id: task.departamento_id || '',
            assigned_to: task.assigned_to || '',
            deadline: task.deadline ? new Date(task.deadline).toISOString().slice(0, 16) : '',
            priority: task.priority || 'medium',
            status: task.status || 'pending',
            drive_link: task.drive_link || ''
        })
        if (task.micro_tasks && task.micro_tasks.length > 0) {
            setEditingMicroTasks(task.micro_tasks.map(mt => ({
                id: mt.id,
                funcao: mt.funcao,
                profissional_id: mt.profissional?.id || '', // Handle alias or direct access
                status: mt.status,
                original: true
            })))
            loadWorkflowReferenceData(task.cliente_id)
        } else {
            setEditingMicroTasks([])
            setWorkflowReferenceData({ professionals: [], functions: [] })
        }
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

    // Workflow Editing Helpers
    function handleAddMicroTask() {
        setEditingMicroTasks([...editingMicroTasks, {
            id: `temp_${Date.now()}`,
            funcao: '',
            profissional_id: '',
            status: 'pendente',
            original: false
        }])
    }

    function handleRemoveMicroTask(index) {
        const newTasks = [...editingMicroTasks]
        newTasks.splice(index, 1)
        setEditingMicroTasks(newTasks)
    }

    function handleUpdateMicroTask(index, field, value) {
        const newTasks = [...editingMicroTasks]
        newTasks[index] = { ...newTasks[index], [field]: value }

        // Auto-select professional if function changes
        if (field === 'funcao') {
            const validProfs = workflowReferenceData.professionals.filter(p => p.funcao === value)
            if (validProfs.length > 0) {
                newTasks[index].profissional_id = validProfs[0].profissional_id
            } else {
                newTasks[index].profissional_id = ''
            }
        }

        setEditingMicroTasks(newTasks)
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
                        profissional:profissionais (
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

    async function handleUpdateTask(e) {
        e.preventDefault()

        if (!formData.titulo.trim()) {
            toast.error('Por favor, insira um título para a tarefa')
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
                drive_link: formData.drive_link.trim() || null,
                completed_at: formData.status === 'completed' ? new Date().toISOString() : null
            }

            const { error } = await supabase
                .from('tarefas')
                .update(taskData)
                .eq('id', selectedTask.id)

            if (error) throw error

            // Handle Workflow Updates
            if (selectedTask.micro_tasks && selectedTask.micro_tasks.length > 0) {
                // 1. Identify Deletions (IDs in original but not in editing)
                const editingIds = editingMicroTasks.filter(mt => mt.original).map(mt => mt.id)
                const toDelete = selectedTask.micro_tasks.filter(mt => !editingIds.includes(mt.id)).map(mt => mt.id)

                if (toDelete.length > 0) {
                    const { error: deleteError } = await supabase
                        .from('tarefas_micro')
                        .delete()
                        .in('id', toDelete)
                    if (deleteError) throw deleteError
                }

                // 2. Identify Updates (Original items with changes)
                const toUpdate = editingMicroTasks.filter(mt => mt.original)
                for (const mt of toUpdate) {
                    const original = selectedTask.micro_tasks.find(o => o.id === mt.id)
                    if (original && (original.profissional_id !== mt.profissional_id || original.status !== mt.status)) {
                        const { error: updateError } = await supabase
                            .from('tarefas_micro')
                            .update({
                                profissional_id: mt.profissional_id,
                                funcao: mt.funcao // Although usually static, why not
                                // Status is updated by dragging in kanban, but here we might want to respect current or reset? 
                                // Let's keep status as is unless we add a status picker in edit. 
                                // Actually user might want to reassign, status should probably preserved or reset if reassigning? 
                                // For now, we only update profissional_id and guarantee matches.
                            })
                            .eq('id', mt.id)
                        if (updateError) throw updateError
                    }
                }

                // 3. Identify Insertions (New items with temp IDs)
                const toInsert = editingMicroTasks
                    .filter(mt => !mt.original)
                    .map(mt => ({
                        tarefa_id: selectedTask.id,
                        funcao: mt.funcao,
                        profissional_id: mt.profissional_id,
                        status: 'pendente', // Default new steps to pending
                        peso: 1 // Default weight
                    }))

                if (toInsert.length > 0) {
                    const { error: insertError } = await supabase
                        .from('tarefas_micro')
                        .insert(toInsert)
                    if (insertError) throw insertError
                }
            }

            toast.success('Tarefa atualizada com sucesso!')
            setShowEditModal(false)
            setSelectedTask(null)
            setEditingMicroTasks([])
            resetForm()
            await fetchData()
        } catch (error) {
            console.error('Error updating task:', error)
            toast.error('Erro ao atualizar tarefa. Tente novamente.')
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
        const filteredTaskIds = getFilteredTasks().map(task => task.id)
        if (selectedTasks.length === filteredTaskIds.length) {
            setSelectedTasks([])
        } else {
            setSelectedTasks(filteredTaskIds)
        }
    }

    function handleCancelSelection() {
        setSelectedTasks([])
    }

    function getFilteredTasks() {
        return tasks.filter(task => {
            const matchesSearch = task.titulo.toLowerCase().includes(searchTerm.toLowerCase())
            const matchesStatus = statusFilter === 'all' || task.status === statusFilter
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

    const filteredTasks = getFilteredTasks()
    const allFilteredSelected = filteredTasks.length > 0 && selectedTasks.length === filteredTasks.length

    if (loading) {
        return (
            <div>
                <div className="dashboard-header">
                    <h2>Gerenciamento de Tarefas</h2>
                </div>
                <div className="card loading-card">
                    <p className="loading-text-primary">Carregando tarefas...</p>
                </div>
            </div>
        )
    }

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
            {/* Header */}
            <div className="dashboard-header admin-tasks-section-spacing">
                <h2>Gerenciamento de Tarefas</h2>
            </div>

            {/* Metrics Cards */}
            <div className="admin-tasks-section-spacing">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="card" style={{ padding: '20px' }}>
                        <p className="text-sm text-slate-500 mb-1">Total de Tarefas</p>
                        <p className="text-2xl font-semibold text-slate-900">{tasks.length}</p>
                    </div>
                    <div className="card" style={{ padding: '20px' }}>
                        <p className="text-sm text-slate-500 mb-1">Em Andamento</p>
                        <p className="text-2xl font-semibold text-indigo-600">
                            {tasks.filter(t => t.status === 'in_progress').length}
                        </p>
                    </div>
                    <div className="card" style={{ padding: '20px' }}>
                        <p className="text-sm text-slate-500 mb-1">Concluídas</p>
                        <p className="text-2xl font-semibold text-green-600">
                            {tasks.filter(t => t.status === 'completed').length}
                        </p>
                    </div>
                    <div className="card" style={{ padding: '20px' }}>
                        <p className="text-sm text-slate-500 mb-1">Atrasadas</p>
                        <p className="text-2xl font-semibold text-red-600">
                            {tasks.filter(t => {
                                const now = new Date()
                                const deadline = new Date(t.deadline)
                                return t.status !== 'completed' && deadline < now
                            }).length}
                        </p>
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

                    <div className="input-group admin-tasks-filter-group">
                        <label htmlFor="assigned">Responsável</label>
                        <select
                            id="assigned"
                            className="input"
                            value={assignedToFilter}
                            onChange={(e) => setAssignedToFilter(e.target.value)}
                        >
                            <option value="all">Todos</option>
                            {professionals.map(prof => (
                                <option key={prof.id} value={prof.id}>{prof.nome}</option>
                            ))}
                        </select>
                    </div>

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
                        {filteredTasks.length} {filteredTasks.length === 1 ? 'tarefa encontrada' : 'tarefas encontradas'}
                    </h3>
                </div>

                {filteredTasks.length === 0 ? (
                    <div className="empty-state">
                        <span className="admin-tasks-empty-icon">
                            <ClipboardList size={64} className="text-slate-300" strokeWidth={1} />
                        </span>
                        <p className="empty-text">
                            {searchTerm || statusFilter !== 'all' || priorityFilter !== 'all' || assignedToFilter !== 'all' || deadlineFilter !== 'all'
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
                                {filteredTasks.map(task => {
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
                                                    <button
                                                        onClick={() => handleOpenEditModal(task)}
                                                        className="btn-icon"
                                                        title="Editar"
                                                    >
                                                        <Edit2 size={18} />
                                                    </button>
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

            {/* Edit Modal */}
            {showEditModal && selectedTask && (
                <div className="modal-backdrop" onClick={() => setShowEditModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Editar Tarefa</h3>
                            <button className="modal-close" onClick={() => setShowEditModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleUpdateTask}>
                            <div className="modal-body">
                                <div className="input-group">
                                    <label htmlFor="edit-titulo">Título *</label>
                                    <input
                                        id="edit-titulo"
                                        type="text"
                                        className="input"
                                        value={formData.titulo}
                                        onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="input-group">
                                    <label htmlFor="edit-descricao">Descrição</label>
                                    <textarea
                                        id="edit-descricao"
                                        className="input"
                                        value={formData.descricao}
                                        onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                                        rows="3"
                                    />
                                </div>

                                <div className="input-group">
                                    <label htmlFor="edit-cliente">Cliente</label>
                                    <select
                                        id="edit-cliente"
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



                                {editingMicroTasks.length > 0 ? (
                                    <div className="input-group">
                                        <label>Etapas do Workflow</label>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
                                            {editingMicroTasks.map((mt, idx) => (
                                                <div key={mt.id} style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '8px',
                                                    padding: '12px',
                                                    border: '1px solid #e2e8f0',
                                                    borderRadius: '8px',
                                                    background: '#f8fafc'
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Etapa {idx + 1}</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveMicroTask(idx)}
                                                            style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}
                                                            title="Remover etapa"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>

                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                                        <div>
                                                            <label style={{ fontSize: '0.75rem', color: '#64748b' }}>Função</label>
                                                            <select
                                                                className="input"
                                                                value={mt.funcao}
                                                                onChange={(e) => handleUpdateMicroTask(idx, 'funcao', e.target.value)}
                                                                style={{ fontSize: '0.85rem', padding: '6px' }}
                                                            >
                                                                <option value="">Selecione...</option>
                                                                {workflowReferenceData.functions.map(fn => (
                                                                    <option key={fn} value={fn}>{fn}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label style={{ fontSize: '0.75rem', color: '#64748b' }}>Profissional</label>
                                                            <select
                                                                className="input"
                                                                value={mt.profissional_id}
                                                                onChange={(e) => handleUpdateMicroTask(idx, 'profissional_id', e.target.value)}
                                                                style={{ fontSize: '0.85rem', padding: '6px' }}
                                                            >
                                                                <option value="">
                                                                    {workflowReferenceData.professionals.filter(p => p.funcao === mt.funcao).length === 0
                                                                        ? 'Nenhum encontrado'
                                                                        : 'Selecione...'}
                                                                </option>
                                                                {workflowReferenceData.professionals
                                                                    .filter(p => p.funcao === mt.funcao)
                                                                    .map(p => (
                                                                        <option key={p.profissional_id} value={p.profissional_id}>
                                                                            {p.profissionais.nome}
                                                                        </option>
                                                                    ))}
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={handleAddMicroTask}
                                                className="btn btn-secondary"
                                                style={{ width: '100%', marginTop: '8px', fontSize: '0.85rem' }}
                                            >
                                                + Adicionar Etapa
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="input-group">
                                        <label htmlFor="edit-assigned_to">Atribuir a</label>
                                        <select
                                            id="edit-assigned_to"
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
                                )}

                                <div className="input-group">
                                    <label htmlFor="edit-deadline">Prazo *</label>
                                    <input
                                        id="edit-deadline"
                                        type="datetime-local"
                                        className="input"
                                        value={formData.deadline}
                                        onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="input-group">
                                    <label htmlFor="edit-status">Status</label>
                                    <select
                                        id="edit-status"
                                        className="input"
                                        value={formData.status}
                                        onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                    >
                                        <option value="pending">Pendente</option>
                                        <option value="in_progress">Em Progresso</option>
                                        <option value="completed">Concluída</option>
                                        <option value="overdue">Atrasada</option>
                                    </select>
                                </div>

                                <div className="input-group">
                                    <label htmlFor="edit-priority">Prioridade</label>
                                    <select
                                        id="edit-priority"
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
                                    <label htmlFor="edit-drive_link">Link do Drive</label>
                                    <input
                                        id="edit-drive_link"
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
                                    onClick={() => setShowEditModal(false)}
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
                                    {submitting ? 'Salvando...' : 'Salvar Alterações'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
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

