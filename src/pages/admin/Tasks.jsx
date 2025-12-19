import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { Edit2, Trash2, ClipboardList, FileText, CheckCircle2 } from 'lucide-react'

function Tasks() {
    const [tasks, setTasks] = useState([])
    const [professionals, setProfessionals] = useState([])
    const [departments, setDepartments] = useState([])
    const [clients, setClients] = useState([])
    const [loading, setLoading] = useState(true)

    // Filters
    const [searchTerm, setSearchTerm] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [priorityFilter, setPriorityFilter] = useState('all')
    const [assignedToFilter, setAssignedToFilter] = useState('all')

    // Modals
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [showEditModal, setShowEditModal] = useState(false)
    const [showDetailModal, setShowDetailModal] = useState(false)
    const [selectedTask, setSelectedTask] = useState(null)

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
    const [feedback, setFeedback] = useState({ show: false, type: '', message: '' })

    useEffect(() => {
        fetchData()
    }, [])

    useEffect(() => {
        if (feedback.show) {
            const timer = setTimeout(() => {
                setFeedback({ show: false, type: '', message: '' })
            }, 5000)
            return () => clearTimeout(timer)
        }
    }, [feedback.show])

    async function fetchData() {
        try {
            setLoading(true)

            const [tasksResult, profsResult, deptsResult, clientsResult] = await Promise.all([
                supabase
                    .from('tarefas')
                    .select('*')
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
                    .from('clientes')
                    .select('id, nome')
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
            showFeedback('error', 'Erro ao carregar dados. Por favor, recarregue a página.')
        } finally {
            setLoading(false)
        }
    }

    function showFeedback(type, message) {
        setFeedback({ show: true, type, message })
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
        resetForm()
        setShowCreateModal(true)
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
        setShowEditModal(true)
    }

    function handleOpenDetailModal(task) {
        setSelectedTask(task)
        setShowDetailModal(true)
    }

    async function handleCreateTask(e) {
        e.preventDefault()

        if (!formData.titulo.trim()) {
            showFeedback('error', 'Por favor, insira um título para a tarefa')
            return
        }

        if (!formData.deadline) {
            showFeedback('error', 'Por favor, defina um prazo para a tarefa')
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

            showFeedback('success', 'Tarefa criada com sucesso!')
            setShowCreateModal(false)
            resetForm()
            await fetchData()
        } catch (error) {
            console.error('Error creating task:', error)
            showFeedback('error', 'Erro ao criar tarefa. Tente novamente.')
        } finally {
            setSubmitting(false)
        }
    }

    async function handleUpdateTask(e) {
        e.preventDefault()

        if (!formData.titulo.trim()) {
            showFeedback('error', 'Por favor, insira um título para a tarefa')
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

            showFeedback('success', 'Tarefa atualizada com sucesso!')
            setShowEditModal(false)
            setSelectedTask(null)
            resetForm()
            await fetchData()
        } catch (error) {
            console.error('Error updating task:', error)
            showFeedback('error', 'Erro ao atualizar tarefa. Tente novamente.')
        } finally {
            setSubmitting(false)
        }
    }

    async function handleDeleteTask(task) {
        if (!confirm(`Tem certeza que deseja excluir a tarefa "${task.titulo}"? Esta ação não pode ser desfeita.`)) {
            return
        }

        try {
            const { error } = await supabase
                .from('tarefas')
                .delete()
                .eq('id', task.id)

            if (error) throw error

            showFeedback('success', 'Tarefa excluída com sucesso!')
            await fetchData()
        } catch (error) {
            console.error('Error deleting task:', error)
            showFeedback('error', 'Erro ao excluir tarefa. Tente novamente.')
        }
    }

    function getFilteredTasks() {
        return tasks.filter(task => {
            // Search filter
            const matchesSearch = task.titulo.toLowerCase().includes(searchTerm.toLowerCase())

            // Status filter
            const matchesStatus = statusFilter === 'all' || task.status === statusFilter

            // Priority filter
            const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter

            // Assigned to filter
            const matchesAssignedTo = assignedToFilter === 'all' || task.assigned_to === assignedToFilter

            return matchesSearch && matchesStatus && matchesPriority && matchesAssignedTo
        })
    }

    function getStatusBadgeClass(status) {
        switch (status) {
            case 'completed':
                return 'badge-success'
            case 'in_progress':
                return 'badge-primary'
            case 'overdue':
                return 'badge-danger'
            default:
                return 'badge-neutral'
        }
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
                return 'badge-danger'
            case 'high':
                return 'badge-warning'
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

    function getClientName(clientId) {
        const client = clients.find(c => c.id === clientId)
        return client ? client.nome : '-'
    }

    function getDepartmentName(deptId) {
        const dept = departments.find(d => d.id === deptId)
        return dept ? dept.nome : '-'
    }

    const filteredTasks = getFilteredTasks()

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

    return (
        <div className="animation-fade-in">
            {/* Standard Dashboard Header */}
            <div className="dashboard-header">
                <h2>Gerenciamento de Tarefas</h2>
                <button onClick={handleOpenCreateModal} className="btn btn-primary">
                    <ClipboardList size={20} style={{ marginRight: '8px' }} />
                    Nova Tarefa
                </button>
            </div>

            {feedback.show && (
                <div className={`card mb-6 p-4 border-${feedback.type === 'success' ? 'success' : 'danger'} bg-${feedback.type === 'success' ? 'success' : 'danger'}-subtle`}>
                    <p className={`text-${feedback.type === 'success' ? 'success' : 'danger'} font-medium m-0`}>
                        {feedback.message}
                    </p>
                </div>
            )}

            {/* Standard Toolbar */}
            <div className="tool-bar">
                <div className="tool-bar-header">
                    <span className="tool-bar-title">Filtros e Busca</span>
                </div>

                <div className="tool-bar-filters">
                    <div className="input-group" style={{ marginBottom: 0 }}>
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

                    <div className="input-group" style={{ marginBottom: 0 }}>
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

                    <div className="input-group" style={{ marginBottom: 0 }}>
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

                    <div className="input-group" style={{ marginBottom: 0 }}>
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
                </div>
            </div>

            {/* Standard Table Card */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '20px', borderBottom: '1px solid #eee' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#333' }}>
                        {filteredTasks.length} {filteredTasks.length === 1 ? 'tarefa encontrada' : 'tarefas encontradas'}
                    </h3>
                </div>

                {filteredTasks.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon" style={{ display: 'inline-flex', justifyContent: 'center', marginBottom: '16px' }}>
                            <ClipboardList size={64} className="text-slate-300" strokeWidth={1} />
                        </span>
                        <p className="empty-text">
                            {searchTerm || statusFilter !== 'all' || priorityFilter !== 'all' || assignedToFilter !== 'all'
                                ? 'Nenhuma tarefa encontrada com os filtros aplicados.'
                                : 'Nenhuma tarefa criada ainda. Comece criando a primeira!'}
                        </p>
                        {!searchTerm && statusFilter === 'all' && priorityFilter === 'all' && assignedToFilter === 'all' && (
                            <button onClick={handleOpenCreateModal} className="btn btn-primary">
                                Criar Primeira Tarefa
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Título</th>
                                    <th>Cliente</th>
                                    <th>Departamento</th>
                                    <th>Atribuída a</th>
                                    <th>Prazo</th>
                                    <th>Status</th>
                                    <th>Prioridade</th>
                                    <th style={{ textAlign: 'right' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredTasks.map(task => (
                                    <tr key={task.id}>
                                        <td>
                                            <button
                                                onClick={() => handleOpenDetailModal(task)}
                                                style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontWeight: 500, cursor: 'pointer', padding: 0 }}
                                            >
                                                {task.titulo}
                                            </button>
                                        </td>
                                        <td>{getClientName(task.cliente_id)}</td>
                                        <td>{getDepartmentName(task.departamento_id)}</td>
                                        <td>{getAssignedToName(task.assigned_to)}</td>
                                        <td>{new Date(task.deadline).toLocaleDateString()}</td>
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
                                        <td style={{ textAlign: 'right' }}>
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                                <button
                                                    onClick={() => handleOpenEditModal(task)}
                                                    className="btn-icon"
                                                    title="Editar"
                                                >
                                                    <Edit2 size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteTask(task)}
                                                    className="btn-icon"
                                                    title="Excluir"
                                                    style={{ color: 'var(--color-danger)' }}
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

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
                                    <label htmlFor="departamento">Departamento</label>
                                    <select
                                        id="departamento"
                                        className="input"
                                        value={formData.departamento_id}
                                        onChange={(e) => setFormData({ ...formData, departamento_id: e.target.value })}
                                    >
                                        <option value="">-- Selecione --</option>
                                        {departments.map(dept => (
                                            <option key={dept.id} value={dept.id}>{dept.nome}</option>
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

                                <div className="input-group">
                                    <label htmlFor="edit-departamento">Departamento</label>
                                    <select
                                        id="edit-departamento"
                                        className="input"
                                        value={formData.departamento_id}
                                        onChange={(e) => setFormData({ ...formData, departamento_id: e.target.value })}
                                    >
                                        <option value="">-- Selecione --</option>
                                        {departments.map(dept => (
                                            <option key={dept.id} value={dept.id}>{dept.nome}</option>
                                        ))}
                                    </select>
                                </div>

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

            {/* Detail Modal */}
            {showDetailModal && selectedTask && (
                <div className="modal-backdrop" onClick={() => setShowDetailModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Detalhes da Tarefa</h3>
                            <button className="modal-close" onClick={() => setShowDetailModal(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="modal-detail-section">
                                <h4 className="modal-detail-title">{selectedTask.titulo}</h4>
                                {selectedTask.descricao && (
                                    <p className="text-muted">{selectedTask.descricao}</p>
                                )}
                            </div>

                            <div className="modal-detail-rows">
                                <div>
                                    <strong>Cliente:</strong> {getClientName(selectedTask.cliente_id)}
                                </div>
                                <div>
                                    <strong>Departamento:</strong> {getDepartmentName(selectedTask.departamento_id)}
                                </div>
                                <div>
                                    <strong>Atribuída a:</strong> {getAssignedToName(selectedTask.assigned_to)}
                                </div>
                                <div>
                                    <strong>Prazo:</strong> {new Date(selectedTask.deadline).toLocaleString()}
                                </div>
                                <div>
                                    <strong>Status:</strong>{' '}
                                    <span className={`badge ${getStatusBadgeClass(selectedTask.status)}`}>
                                        {getStatusLabel(selectedTask.status)}
                                    </span>
                                </div>
                                <div>
                                    <strong>Prioridade:</strong>{' '}
                                    <span className={`badge ${getPriorityBadgeClass(selectedTask.priority)}`}>
                                        {getPriorityLabel(selectedTask.priority)}
                                    </span>
                                </div>
                                {selectedTask.drive_link && (
                                    <div>
                                        <strong>Arquivos:</strong>{' '}
                                        <a
                                            href={selectedTask.drive_link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="modal-detail-link"
                                        >
                                            📎 Abrir Link do Drive
                                        </a>
                                    </div>
                                )}
                                {selectedTask.completed_at && (
                                    <div>
                                        <strong>Concluída em:</strong> {new Date(selectedTask.completed_at).toLocaleString()}
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button
                                onClick={() => {
                                    setShowDetailModal(false)
                                    handleOpenEditModal(selectedTask)
                                }}
                                className="btn btn-secondary"
                            >
                                Editar
                            </button>
                            <button
                                onClick={() => setShowDetailModal(false)}
                                className="btn btn-primary"
                            >
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Tasks
