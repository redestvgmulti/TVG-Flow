import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import {
    CheckCircle2,
    Clock,
    AlertCircle,
    Calendar,
    FileText,
    ExternalLink,
    Search
} from 'lucide-react'

function StaffDashboard() {
    const { professionalId, professionalName } = useAuth()
    const [stats, setStats] = useState({
        totalAssigned: 0,
        pending: 0,
        completed: 0
    })
    const [myTasks, setMyTasks] = useState([])
    const [originalTasks, setOriginalTasks] = useState([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')
    const [feedback, setFeedback] = useState({ show: false, type: '', message: '' })

    // Date formatting for header
    const today = new Date().toLocaleDateString('pt-BR', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    })

    useEffect(() => {
        if (professionalId) {
            fetchMyTasks()
        }
    }, [professionalId])

    useEffect(() => {
        if (feedback.show) {
            const timer = setTimeout(() => {
                setFeedback({ show: false, type: '', message: '' })
            }, 5000)
            return () => clearTimeout(timer)
        }
    }, [feedback.show])

    // Filter tasks when searchTerm changes
    useEffect(() => {
        if (!searchTerm) {
            setMyTasks(originalTasks)
        } else {
            const filtered = originalTasks.filter(task =>
                task.titulo.toLowerCase().includes(searchTerm.toLowerCase())
            )
            setMyTasks(filtered)
        }
    }, [searchTerm, originalTasks])

    async function fetchMyTasks() {
        try {
            setLoading(true)

            const { data: tasks, error } = await supabase
                .from('tarefas')
                .select('id, titulo, deadline, status, priority, created_at, drive_link, descricao')
                .eq('assigned_to', professionalId)
                .order('created_at', { ascending: false })

            if (error) throw error

            const total = tasks?.length || 0
            const pending = tasks?.filter(t => t.status === 'pending' || t.status === 'in_progress').length || 0
            const completed = tasks?.filter(t => t.status === 'completed').length || 0

            setStats({
                totalAssigned: total,
                pending,
                completed
            })

            setOriginalTasks(tasks || [])
            setMyTasks(tasks || [])
        } catch (error) {
            console.error('Error fetching tasks:', error)
            showFeedback('error', 'Falha ao carregar suas tarefas')
        } finally {
            setLoading(false)
        }
    }

    function showFeedback(type, message) {
        setFeedback({ show: true, type, message })
    }

    async function handleUpdateStatus(taskId, newStatus, taskTitle) {
        if (newStatus === 'completed') {
            await handleCompleteTask(taskId, taskTitle)
            return
        }

        try {
            const { error } = await supabase
                .from('tarefas')
                .update({
                    status: newStatus,
                    completed_at: null // Reset if moving back from completed
                })
                .eq('id', taskId)

            if (error) throw error

            showFeedback('success', 'Status da tarefa atualizado')
            await fetchMyTasks()
        } catch (error) {
            console.error('Error updating task:', error)
            showFeedback('error', 'Falha ao atualizar status')
        }
    }

    async function handleCompleteTask(taskId, taskTitle) {
        if (!confirm(`Marcar "${taskTitle}" como concluída?`)) {
            return
        }

        try {
            const { error } = await supabase
                .from('tarefas')
                .update({
                    status: 'completed',
                    completed_at: new Date().toISOString()
                })
                .eq('id', taskId)

            if (error) throw error

            showFeedback('success', 'Tarefa concluída com sucesso! 🎉')
            await fetchMyTasks()
        } catch (error) {
            console.error('Error completing task:', error)
            showFeedback('error', 'Falha ao concluir tarefa')
        }
    }

    function getStatusBadgeClass(status) {
        switch (status) {
            case 'completed': return 'badge-success'
            case 'in_progress': return 'badge-primary'
            case 'overdue': return 'badge-danger'
            default: return 'badge-neutral'
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
            case 'urgent': return 'badge-danger'
            case 'high': return 'badge-warning'
            default: return 'badge-neutral'
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

    if (loading) {
        return (
            <div className="flex justify-center items-center h-full p-8">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-tertiary">Carregando painel...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in pb-8">
            {/* Header Section */}
            <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <p className="text-sm text-tertiary uppercase tracking-wide font-semibold mb-1">
                        {today}
                    </p>
                    <h1 className="text-3xl font-bold text-primary">
                        Olá, {professionalName?.split(' ')[0] || 'Colaborador'}! 👋
                    </h1>
                    <p className="text-secondary mt-1">
                        Aqui está o resumo das suas atividades hoje.
                    </p>
                </div>
            </div>

            {feedback.show && (
                <div className={`card mb-6 p-4 border-${feedback.type === 'success' ? 'success' : 'danger'} bg-${feedback.type === 'success' ? 'success' : 'danger'}-subtle`}>
                    <p className={`text-${feedback.type === 'success' ? 'success' : 'danger'} font-medium m-0 flex items-center gap-2`}>
                        {feedback.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                        {feedback.message}
                    </p>
                </div>
            )}

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="card p-6 flex flex-col justify-between hover:shadow-md transition-all duration-200">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-bold text-tertiary uppercase tracking-wide">
                                Pendentes
                            </h3>
                            <div className="p-2 bg-neutral-100 rounded-full text-tertiary">
                                <Clock size={20} />
                            </div>
                        </div>
                        <p className="text-3xl font-bold text-primary">{stats.pending}</p>
                    </div>
                </div>

                <div className="card p-6 flex flex-col justify-between hover:shadow-md transition-all duration-200">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-bold text-tertiary uppercase tracking-wide">
                                Concluídas
                            </h3>
                            <div className="p-2 bg-green-50 rounded-full text-success">
                                <CheckCircle2 size={20} />
                            </div>
                        </div>
                        <p className="text-3xl font-bold text-primary">{stats.completed}</p>
                    </div>
                </div>

                <div className="card p-6 flex flex-col justify-between hover:shadow-md transition-all duration-200">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-bold text-tertiary uppercase tracking-wide">
                                Total Atribuído
                            </h3>
                            <div className="p-2 bg-blue-50 rounded-full text-brand">
                                <FileText size={20} />
                            </div>
                        </div>
                        <p className="text-3xl font-bold text-primary">{stats.totalAssigned}</p>
                    </div>
                </div>
            </div>

            {/* Tasks Section */}
            <div className="card overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <h2 className="text-xl font-bold text-primary flex items-center gap-2">
                        <Calendar className="text-brand" size={24} />
                        Minhas Tarefas
                    </h2>

                    {/* Search Bar */}
                    <div className="relative w-full md:w-64">
                        <input
                            type="text"
                            placeholder="Buscar tarefa..."
                            className="input w-full pl-10"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-tertiary" size={16} />
                    </div>
                </div>

                {myTasks.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="inline-flex justify-center items-center w-16 h-16 rounded-full bg-neutral-100 mb-4">
                            <CheckCircle2 size={32} className="text-tertiary" />
                        </div>
                        <h3 className="text-lg font-semibold text-primary mb-1">
                            {searchTerm ? 'Nenhuma tarefa encontrada' : 'Tudo limpo por aqui!'}
                        </h3>
                        <p className="text-tertiary max-w-md mx-auto">
                            {searchTerm
                                ? 'Tente buscar por outro termo.'
                                : 'Você não tem tarefas pendentes no momento. Aproveite seu dia!'}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="table w-full">
                            <thead>
                                <tr className="text-left bg-subtle border-b border-gray-100">
                                    <th className="p-4 font-semibold text-secondary text-sm">Tarefa</th>
                                    <th className="p-4 font-semibold text-secondary text-sm">Prazo</th>
                                    <th className="p-4 font-semibold text-secondary text-sm">Status</th>
                                    <th className="p-4 font-semibold text-secondary text-sm">Prioridade</th>
                                    <th className="p-4 font-semibold text-secondary text-sm text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {myTasks.map(task => (
                                    <tr key={task.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                                        <td className="p-4">
                                            <div className="font-medium text-primary mb-1">{task.titulo}</div>
                                            {task.drive_link && (
                                                <a
                                                    href={task.drive_link}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                                                >
                                                    <ExternalLink size={12} />
                                                    Ver Arquivos
                                                </a>
                                            )}
                                        </td>
                                        <td className="p-4 text-sm text-secondary">
                                            {new Date(task.deadline).toLocaleDateString()}
                                            <div className="text-xs text-tertiary">
                                                {new Date(task.deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className={`badge ${getStatusBadgeClass(task.status)}`}>
                                                {getStatusLabel(task.status)}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <span className={`badge ${getPriorityBadgeClass(task.priority)}`}>
                                                {getPriorityLabel(task.priority)}
                                            </span>
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {task.status !== 'completed' && (
                                                    <button
                                                        onClick={() => handleCompleteTask(task.id, task.titulo)}
                                                        className="btn btn-sm btn-outline-success hover:bg-green-50 text-success border-success"
                                                        title="Concluir Tarefa"
                                                    >
                                                        <CheckCircle2 size={16} />
                                                        <span className="hidden md:inline ml-1">Concluir</span>
                                                    </button>
                                                )}

                                                <select
                                                    value={task.status}
                                                    onChange={(e) => handleUpdateStatus(task.id, e.target.value, task.titulo)}
                                                    className="input py-1 px-2 text-xs w-auto h-auto"
                                                    style={{ minWidth: '100px' }}
                                                >
                                                    <option value="pending">Pendente</option>
                                                    <option value="in_progress">Em Progresso</option>
                                                    <option value="completed">Concluída</option>
                                                </select>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}

export default StaffDashboard
