import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../services/supabase'
import {
    Search,
    Filter,
    ArrowRight,
    Calendar,
    Clock,
    AlertCircle,
    CheckCircle2,
    ArrowUpCircle,
    Send,
    History,
    FileText,
    ExternalLink,
    Maximize2
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../contexts/AuthContext'
import { useRefresh } from '../../contexts/RefreshContext'

export default function StaffTasks() {
    const { user } = useAuth()
    const { registerRefresh, unregisterRefresh } = useRefresh()
    const [tasks, setTasks] = useState([])
    const [filteredTasks, setFilteredTasks] = useState([])
    const [loading, setLoading] = useState(true)

    // Modal & Detail State
    const [selectedTask, setSelectedTask] = useState(null)
    const [timeline, setTimeline] = useState([])
    const [loadingTimeline, setLoadingTimeline] = useState(false)
    const [newComment, setNewComment] = useState('')
    const [sendingComment, setSendingComment] = useState(false)
    const [updating, setUpdating] = useState(false)

    // Filters
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [priorityFilter, setPriorityFilter] = useState('all')

    useEffect(() => {
        fetchTasks()

        // Register pull-to-refresh
        registerRefresh(async () => {
            await fetchTasks(true) // Silent refresh
        })

        return () => unregisterRefresh()
    }, [])

    useEffect(() => {
        filterTasks()
    }, [search, statusFilter, priorityFilter, tasks])

    async function fetchTasks(silent = false) {
        try {
            if (!silent) setLoading(true)
            const { data, error } = await supabase
                .from('tarefas')
                .select('*')
                .order('deadline', { ascending: true }) // Upcoming deadlines first

            if (error) throw error
            setTasks(data || [])
        } catch (error) {
            console.error('Error fetching tasks:', error)
            toast.error('Erro ao atualizar tarefas')
        } finally {
            if (!silent) setLoading(false)
        }
    }

    function filterTasks() {
        let result = [...tasks]

        // 1. Status Filter
        if (statusFilter !== 'all') {
            if (statusFilter === 'active') {
                result = result.filter(t => t.status === 'pending' || t.status === 'in_progress')
            } else {
                result = result.filter(t => t.status === statusFilter)
            }
        }

        // 2. Priority Filter
        if (priorityFilter !== 'all') {
            result = result.filter(t => t.priority === priorityFilter)
        }

        // 3. Search
        if (search) {
            const lowerDate = search.toLowerCase()
            result = result.filter(t =>
                t.titulo.toLowerCase().includes(lowerDate) ||
                (t.descricao && t.descricao.toLowerCase().includes(lowerDate))
            )
        }

        setFilteredTasks(result)
    }

    // Modal Functions
    async function openTaskModal(task) {
        setSelectedTask(task)
        fetchTimeline(task.id)
    }

    async function fetchTimeline(taskId) {
        try {
            setLoadingTimeline(true)
            // 1. Fetch Comments
            const { data: comments, error: commentsError } = await supabase
                .from('task_comments')
                .select('id, content, created_at, author_id, profissionais(nome)')
                .eq('task_id', taskId)
                .order('created_at', { ascending: true })

            if (commentsError) throw commentsError

            // 2. Fetch History
            const { data: history, error: historyError } = await supabase
                .from('task_history')
                .select('id, event, created_at')
                .eq('task_id', taskId)
                .order('created_at', { ascending: true })

            if (historyError) throw historyError

            // 3. Merge and Sort
            const combined = [
                ...(comments || []).map(c => ({ ...c, type: 'comment' })),
                ...(history || []).map(h => ({ ...h, type: 'history' }))
            ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

            setTimeline(combined)
        } catch (error) {
            console.error('Error fetching timeline:', error)
        } finally {
            setLoadingTimeline(false)
        }
    }

    async function handleStatusChange(taskId, newStatus) {
        setUpdating(true)
        try {
            const updates = {
                status: newStatus,
                completed_at: newStatus === 'completed' ? new Date().toISOString() : null
            }

            const { error } = await supabase
                .from('tarefas')
                .update(updates)
                .eq('id', taskId)

            if (error) throw error

            // Update local state
            setSelectedTask(prev => prev ? { ...prev, ...updates } : null)
            setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))

            if (newStatus === 'completed') {
                toast.success('Tarefa concluída! 🎉')
                setTimeout(() => setSelectedTask(null), 1500)
            } else {
                toast.success('Status atualizado')
            }

            // Refresh timeline
            setTimeout(() => fetchTimeline(taskId), 500)

        } catch (error) {
            console.error('Error updating status:', error)
            toast.error('Erro ao atualizar status')
        } finally {
            setUpdating(false)
        }
    }

    async function handleSendComment(e) {
        e.preventDefault()
        if (!newComment.trim() || !selectedTask) return

        setSendingComment(true)
        try {
            const { error } = await supabase
                .from('task_comments')
                .insert({
                    task_id: selectedTask.id,
                    author_id: user.id,
                    content: newComment.trim()
                })

            if (error) throw error

            setNewComment('')
            fetchTimeline(selectedTask.id)
            toast.success('Nota adicionada')
        } catch (error) {
            console.error('Error sending comment:', error)
            toast.error('Não foi possível enviar o comentário')
        } finally {
            setSendingComment(false)
        }
    }

    if (loading) {
        return (
            <div className="flex justify-center items-center h-full p-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in pb-12">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-primary mb-2">Minhas Tarefas</h1>
                <p className="text-secondary">Gerencie suas atividades e prazos.</p>
            </div>

            {/* Controls Bar */}
            <div className="card p-4 mb-6 sticky top-4 z-10 backdrop-blur-md bg-white/80 border-gray-100 shadow-sm">
                <div className="flex flex-col gap-4">
                    <div className="relative w-full">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-tertiary" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar tarefa..."
                            className="input pl-10 w-full"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <select
                            className="input w-full text-sm"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="all">Status</option>
                            <option value="active">Em Aberto</option>
                            <option value="pending">Pendente</option>
                            <option value="in_progress">Em Andamento</option>
                            <option value="completed">Concluída</option>
                        </select>

                        <select
                            className="input w-full text-sm"
                            value={priorityFilter}
                            onChange={(e) => setPriorityFilter(e.target.value)}
                        >
                            <option value="all">Prioridade</option>
                            <option value="urgent">Urgente</option>
                            <option value="high">Alta</option>
                            <option value="medium">Média</option>
                            <option value="low">Baixa</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Tasks Grid */}
            {filteredTasks.length === 0 ? (
                <div className="empty-state">
                    <span className="empty-icon">📝</span>
                    <h3 className="text-lg font-medium text-secondary mb-1">Nenhuma tarefa encontrada</h3>
                    <p className="empty-text">Ajuste os filtros ou busque por outro termo.</p>
                    <button
                        className="btn btn-secondary mt-2"
                        onClick={() => {
                            setSearch('')
                            setStatusFilter('all')
                            setPriorityFilter('all')
                        }}
                    >
                        Limpar Filtros
                    </button>
                </div>
            ) : (
                <div className="task-list">
                    {filteredTasks.map(task => {
                        const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== 'completed'

                        return (
                            <div
                                key={task.id}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openTaskModal(task);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        openTaskModal(task);
                                    }
                                }}
                                role="button"
                                tabIndex={0}
                                className="task-item card relative z-0 hover:border-brand-light/50 transition-all duration-200 group bg-white !no-underline hover:!no-underline cursor-pointer active:scale-[0.99]"
                            >
                                <div className="task-item-content">
                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                        <h3 className="task-item-title group-hover:text-brand transition-colors text-base flex items-center gap-2">
                                            {task.titulo}
                                        </h3>
                                        {isOverdue && (
                                            <span className="text-danger flex items-center gap-1" title="Atrasada">
                                                <AlertCircle size={14} />
                                            </span>
                                        )}
                                        <span
                                            className="rounded-full font-semibold border"
                                            style={{
                                                backgroundColor: task.priority === 'urgent' ? '#fef2f2' :
                                                    task.priority === 'high' ? '#fff7ed' :
                                                        task.priority === 'medium' ? '#fefce8' : '#f9fafb',
                                                color: task.priority === 'urgent' ? '#dc2626' :
                                                    task.priority === 'high' ? '#ea580c' :
                                                        task.priority === 'medium' ? '#ca8a04' : '#6b7280',
                                                borderColor: task.priority === 'urgent' ? '#fecaca' :
                                                    task.priority === 'high' ? '#fed7aa' :
                                                        task.priority === 'medium' ? '#fef08a' : '#e5e7eb',
                                                fontSize: '10px',
                                                padding: '3px 10px',
                                                textTransform: 'none'
                                            }}
                                        >                                          {task.priority === 'urgent' ? 'Urgente' :
                                            task.priority === 'high' ? 'Alta' :
                                                task.priority === 'medium' ? 'Média' : 'Baixa'}
                                        </span>
                                    </div>

                                    <div className="task-item-meta flex items-center gap-3">
                                        {task.deadline && (
                                            <span className={`flex items-center gap-1.5 ${isOverdue ? 'text-danger' : 'text-tertiary'}`}>
                                                <Calendar size={13} className="opacity-70" />
                                                <span className="font-medium">{new Date(task.deadline).toLocaleDateString('pt-BR')}</span>
                                                <span className="opacity-60 hidden xs:inline">
                                                    • {new Date(task.deadline).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="task-item-actions flex-col items-end gap-2 mt-3 md:mt-0">
                                    <span
                                        className="relative overflow-hidden px-3.5 py-1 rounded-full text-[10px] font-semibold border shadow-sm transition-all duration-300"
                                        style={{
                                            backgroundColor: task.status === 'in_progress' ? '#eff6ff' :
                                                task.status === 'completed' ? '#f0fdf4' : '#fff7ed',
                                            color: task.status === 'in_progress' ? '#2563eb' :
                                                task.status === 'completed' ? '#16a34a' : '#c2410c',
                                            borderColor: task.status === 'in_progress' ? '#bfdbfe' :
                                                task.status === 'completed' ? '#bbf7d0' : '#fed7aa',
                                            fontSize: '10px',
                                            fontWeight: 600,
                                            padding: '4px 12px',
                                            textTransform: 'none'
                                        }}
                                    >
                                        <span className="relative z-10 flex items-center gap-1.5">
                                            {task.status === 'in_progress' ? <Clock size={11} className="animate-pulse" /> :
                                                task.status === 'completed' ? <CheckCircle2 size={11} /> :
                                                    <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]"></div>}

                                            {task.status === 'in_progress' ? 'Em andamento' :
                                                task.status === 'completed' ? 'Concluída' : 'Pendente'}
                                        </span>
                                    </span>

                                    <div className="text-brand opacity-0 group-hover:opacity-100 transition-opacity translate-x-[-10px] group-hover:translate-x-0 duration-200 hidden md:block">
                                        <ArrowRight size={16} />
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Task Detail Modal - Teleported to Body */}
            {selectedTask && createPortal(
                <div className="modal-backdrop" onClick={() => setSelectedTask(null)}>
                    <div
                        className="modal"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            maxWidth: '48rem',
                            maxHeight: '90vh',
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden'
                        }}
                    >
                        {/* Glass Header */}
                        <div
                            className="border-b flex items-start justify-between z-10 shrink-0 sticky top-0"
                            style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.8)',
                                backdropFilter: 'blur(20px)',
                                WebkitBackdropFilter: 'blur(20px)',
                                borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
                                paddingLeft: '32px',
                                paddingRight: '32px',
                                paddingTop: '24px',
                                paddingBottom: '24px'
                            }}
                        >
                            <div className="flex-1 min-w-0" style={{ marginRight: '16px' }}>
                                <div className="flex items-center gap-3 mb-3">
                                    <h2 className="modal-title flex-1 min-w-0 truncate m-0">
                                        {selectedTask.titulo}
                                    </h2>
                                    <span
                                        className="priority-badge flex-shrink-0"
                                        style={{
                                            backgroundColor: selectedTask.priority === 'urgent' ? '#FEF2F2' :
                                                selectedTask.priority === 'high' ? '#FFF7ED' :
                                                    selectedTask.priority === 'medium' ? '#FEFCE8' : '#F9FAFB',
                                            color: selectedTask.priority === 'urgent' ? '#DC2626' :
                                                selectedTask.priority === 'high' ? '#EA580C' :
                                                    selectedTask.priority === 'medium' ? '#CA8A04' : '#6B7280',
                                            borderColor: selectedTask.priority === 'urgent' ? '#FECACA' :
                                                selectedTask.priority === 'high' ? '#FED7AA' :
                                                    selectedTask.priority === 'medium' ? '#FEF08A' : '#E5E7EB'
                                        }}
                                    >
                                        <div className="priority-badge-dot" style={{ boxShadow: '0 0 8px currentColor' }}></div>
                                        {selectedTask.priority === 'urgent' ? 'Urgente' :
                                            selectedTask.priority === 'high' ? 'Alta' :
                                                selectedTask.priority === 'medium' ? 'Média' : 'Baixa'}
                                    </span>
                                </div>

                                <div className="flex items-start gap-8 text-sm text-gray-500 mt-4">
                                    {selectedTask.deadline && (
                                        <div className="flex flex-col flex-1">
                                            <span className="label-text">Prazo Final</span>
                                            <span className="label-value">
                                                {new Date(selectedTask.deadline).toLocaleDateString('pt-BR')}
                                                {' '}
                                                <span className="label-value-secondary">
                                                    {new Date(selectedTask.deadline).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </span>
                                        </div>
                                    )}
                                    <div className="flex flex-col flex-1">
                                        <span className="label-text">Criada em</span>
                                        <span className="label-value">
                                            {new Date(selectedTask.created_at).toLocaleDateString('pt-BR')}
                                        </span>
                                    </div>
                                </div>
                            </div>


                            <button className="modal-close" onClick={() => setSelectedTask(null)}>×</button>
                        </div>

                        {/* Body - Scrollable */}
                        <div
                            className="flex-1 scrollbar-hide"
                            style={{
                                overflowY: 'auto',
                                maxHeight: 'calc(90vh - 120px)',
                                padding: '24px 32px'
                            }}
                        >
                            <div className="flex flex-col md:flex-row gap-6">
                                {/* Left: Content & Status */}
                                <div className="flex-1">
                                    {/* Status Box */}
                                    <div className="bg-white p-8 rounded-xl border border-gray-200 flex flex-col items-center gap-6 text-center shadow-sm">
                                        <div className="w-full">
                                            <span className="status-label block mb-4">Status Atual</span>

                                            <div className="relative w-full max-w-xs mx-auto">
                                                <select
                                                    value={selectedTask.status}
                                                    onChange={(e) => handleStatusChange(selectedTask.id, e.target.value)}
                                                    disabled={updating}
                                                    className={`input w-full h-12 text-center font-medium appearance-none cursor-pointer ${selectedTask.status === 'completed' ? 'text-success border-success bg-success/5' : 'text-primary'
                                                        }`}
                                                >
                                                    <option value="pending">Pendente</option>
                                                    <option value="in_progress">Em andamento</option>
                                                    <option value="completed">Concluída</option>
                                                </select>

                                            </div>
                                        </div>

                                        {selectedTask.status !== 'completed' && (
                                            <button
                                                onClick={() => handleStatusChange(selectedTask.id, 'completed')}
                                                disabled={updating}
                                                className="btn w-full max-w-xs flex items-center justify-center gap-2"
                                                style={{
                                                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                                    color: '#ffffff',
                                                    boxShadow: '0 2px 4px rgba(16, 185, 129, 0.2)',
                                                    border: 'none'
                                                }}
                                                onMouseEnter={(e) => {
                                                    if (!updating) {
                                                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.3)';
                                                        e.currentTarget.style.transform = 'translateY(-1px)';
                                                    }
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.boxShadow = '0 2px 4px rgba(16, 185, 129, 0.2)';
                                                    e.currentTarget.style.transform = 'translateY(0)';
                                                }}
                                            >
                                                <CheckCircle2 size={18} />
                                                Concluir Tarefa
                                            </button>
                                        )}
                                    </div>

                                    {/* Description */}
                                    <div className="mt-8">
                                        <h3 className="section-title">
                                            Descrição
                                        </h3>
                                        <div className="min-h-[100px] p-4 rounded-lg border border-gray-100/50 bg-white">
                                            {selectedTask.descricao ? (
                                                <p className="content-text whitespace-pre-wrap">{selectedTask.descricao}</p>
                                            ) : (
                                                <p className="empty-state-text">Sem descrição fornecida.</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Link */}
                                    {selectedTask.drive_link && (
                                        <div className="mt-6">
                                            <a
                                                href={selectedTask.drive_link}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="card p-4 flex items-center gap-3 hover:bg-subtle hover:border-brand-light transition-colors group"
                                            >
                                                <div className="p-2 bg-blue-50 text-brand rounded-lg group-hover:bg-white transition-colors">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                                </div>
                                                <div>
                                                    <p className="font-medium text-primary text-sm group-hover:text-brand transition-colors">Abrir arquivos anexos</p>
                                                    <p className="text-xs text-tertiary truncate max-w-[200px]">{selectedTask.drive_link}</p>
                                                </div>
                                            </a>
                                        </div>
                                    )}
                                </div>

                                {/* Right: Activity (Gray Background) */}
                                <div className="w-full md:w-[320px] bg-subtle/50 border-l border-gray-100 flex flex-col">
                                    <div className="p-6">
                                        <h3 className="section-title">
                                            Atividade
                                        </h3>
                                    </div>

                                    <div
                                        className="flex-1 overflow-y-auto space-y-3 max-h-[400px] md:max-h-none"
                                        style={{ paddingLeft: '24px', paddingRight: '24px', paddingTop: '16px', paddingBottom: '16px' }}
                                    >
                                        {loadingTimeline ? (
                                            <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div></div>
                                        ) : timeline.length === 0 ? (
                                            <div className="empty-state-text text-center py-8">Nenhuma atividade recente.</div>
                                        ) : (
                                            timeline.map((item) => (
                                                <div
                                                    key={item.id}
                                                    className="pb-4 border-b border-gray-100 last:border-0 last:pb-0"
                                                    style={item.type === 'comment' ? {
                                                        backgroundColor: '#f9fafb',
                                                        padding: '12px',
                                                        borderRadius: '8px',
                                                        marginLeft: '-12px',
                                                        marginRight: '-12px'
                                                    } : {}}
                                                >
                                                    <div className="flex items-start justify-between mb-2">
                                                        <span className="text-sm font-medium text-gray-900">
                                                            {item.type === 'comment' ? (item.profissionais?.nome || 'Você') : 'Sistema'}
                                                        </span>
                                                        <span className="text-xs text-gray-400">
                                                            {new Date(item.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <p className={`text-sm ${item.type === 'comment' ? 'text-gray-700' : 'text-gray-500 italic'}`}>
                                                        {item.type === 'comment' ? item.content : item.event}
                                                    </p>
                                                </div>
                                            ))
                                        )}
                                    </div>

                                    <div className="p-3 bg-white border-t border-gray-100">
                                        <form onSubmit={handleSendComment} className="relative">
                                            <input
                                                type="text"
                                                className="input w-full pr-10 py-2.5 text-xs bg-subtle hover:bg-white transition-colors"
                                                placeholder="Adicionar nota..."
                                                value={newComment}
                                                onChange={(e) => setNewComment(e.target.value)}
                                                disabled={sendingComment}
                                            />
                                            <button
                                                type="submit"
                                                disabled={!newComment.trim() || sendingComment}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-brand hover:text-brand-dark disabled:opacity-30 disabled:cursor-not-allowed p-1"
                                            >
                                                <Send size={14} />
                                            </button>
                                        </form>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}
