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

export default function StaffTasks() {
    const { user } = useAuth()
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
    }, [])

    useEffect(() => {
        filterTasks()
    }, [search, statusFilter, priorityFilter, tasks])

    async function fetchTasks() {
        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('tarefas')
                .select('*')
                .order('deadline', { ascending: true }) // Upcoming deadlines first

            if (error) throw error
            setTasks(data || [])
        } catch (error) {
            console.error('Error fetching tasks:', error)
        } finally {
            setLoading(false)
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
                                onClick={() => openTaskModal(task)} // Open modal on click
                                className="task-item card hover:border-brand-light/50 transition-colors group bg-white !no-underline hover:!no-underline cursor-pointer"
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
                <div
                    className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6 animation-fade-in"
                    style={{ zIndex: 9999 }}
                >
                    <div
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
                        onClick={() => setSelectedTask(null)}
                    />

                    <div className="relative bg-white w-full h-full md:h-auto md:max-h-[85vh] md:max-w-3xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden animation-slide-up md:animation-scale-in font-sans">
                        {/* Glass Header */}
                        <div
                            className="px-6 py-5 border-b border-gray-100 flex items-start justify-between z-10 shrink-0 sticky top-0"
                            style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                backdropFilter: 'blur(20px)',
                                WebkitBackdropFilter: 'blur(20px)'
                            }}
                        >
                            <div className="flex-1 min-w-0 mr-6">
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                    <span
                                        className="rounded-full font-bold border flex items-center gap-1.5"
                                        style={{
                                            backgroundColor: selectedTask.priority === 'urgent' ? '#FEF2F2' :
                                                selectedTask.priority === 'high' ? '#FFF7ED' :
                                                    selectedTask.priority === 'medium' ? '#FEFCE8' : '#F9FAFB',
                                            color: selectedTask.priority === 'urgent' ? '#DC2626' :
                                                selectedTask.priority === 'high' ? '#EA580C' :
                                                    selectedTask.priority === 'medium' ? '#CA8A04' : '#6B7280',
                                            borderColor: selectedTask.priority === 'urgent' ? '#FECACA' :
                                                selectedTask.priority === 'high' ? '#FED7AA' :
                                                    selectedTask.priority === 'medium' ? '#FEF08A' : '#E5E7EB',
                                            fontSize: '11px',
                                            padding: '4px 10px',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.05em'
                                        }}
                                    >
                                        <div style={{
                                            width: '6px', height: '6px', borderRadius: '50%',
                                            backgroundColor: 'currentColor'
                                        }}></div>
                                        {selectedTask.priority === 'urgent' ? 'Urgente' :
                                            selectedTask.priority === 'high' ? 'Alta' :
                                                selectedTask.priority === 'medium' ? 'Média' : 'Baixa'}
                                    </span>
                                </div>
                                <h2 className="text-2xl md:text-3xl font-bold text-gray-900 leading-tight mb-3 tracking-tight">
                                    {selectedTask.titulo}
                                </h2>

                                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500">
                                    {selectedTask.deadline && (
                                        <div className="flex items-center gap-2">
                                            <div className="p-1.5 rounded-md bg-gray-50 text-gray-400">
                                                <Calendar size={14} />
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 leading-none mb-0.5">Prazo Final</span>
                                                <span className="font-medium text-gray-700">
                                                    {new Date(selectedTask.deadline).toLocaleDateString('pt-BR')}
                                                    <span className="text-gray-400 ml-1 font-normal">
                                                        {new Date(selectedTask.deadline).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <div className="p-1.5 rounded-md bg-gray-50 text-gray-400">
                                            <Clock size={14} />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 leading-none mb-0.5">Criada em</span>
                                            <span className="font-medium text-gray-700">
                                                {new Date(selectedTask.created_at).toLocaleDateString('pt-BR')}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => setSelectedTask(null)}
                                className="group relative p-2 rounded-full hover:bg-gray-100 transition-all duration-200 border border-transparent hover:border-gray-200"
                                aria-label="Fechar"
                            >
                                <div className="absolute inset-0 rounded-full bg-gray-500/0 group-hover:bg-gray-500/5 transition-colors" />
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="24"
                                    height="24"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="text-gray-400 group-hover:text-gray-800 transition-colors"
                                >
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                </svg>
                            </button>
                        </div>

                        {/* Body - Scrollable */}
                        <div className="flex-1 overflow-y-auto p-0 scrollbar-hide">
                            <div className="flex flex-col md:flex-row h-full">
                                {/* Left: Content & Status */}
                                <div className="flex-1 p-6 md:p-8 space-y-8">
                                    {/* Status Box */}
                                    <div className="bg-subtle p-6 rounded-xl border border-gray-100 flex flex-col items-center gap-4 text-center">
                                        <span className="text-xs font-bold text-tertiary uppercase tracking-wider">Status Atual</span>

                                        <div className="relative w-full max-w-xs">
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
                                            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-tertiary">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                                            </div>
                                        </div>

                                        {selectedTask.status !== 'completed' && (
                                            <button
                                                onClick={() => handleStatusChange(selectedTask.id, 'completed')}
                                                disabled={updating}
                                                className="btn btn-black w-full max-w-xs flex items-center justify-center gap-2 py-3 shadow-lg hover:shadow-xl transition-all"
                                            >
                                                <CheckCircle2 size={18} />
                                                Concluir Tarefa
                                            </button>
                                        )}
                                    </div>

                                    {/* Description */}
                                    <div>
                                        <h3 className="text-sm font-bold text-primary uppercase tracking-wider mb-3 flex items-center gap-2 text-tertiary">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
                                            Descrição
                                        </h3>
                                        <div className="min-h-[100px] p-4 rounded-lg border border-gray-100/50">
                                            {selectedTask.descricao ? (
                                                <p className="text-secondary whitespace-pre-wrap leading-relaxed">{selectedTask.descricao}</p>
                                            ) : (
                                                <p className="italic text-tertiary">Sem descrição fornecida.</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Link */}
                                    {selectedTask.drive_link && (
                                        <div>
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
                                    <div className="p-4 border-b border-gray-100 bg-subtle/30">
                                        <h3 className="text-xs font-bold text-tertiary uppercase tracking-wider flex items-center gap-2">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                            Atividade
                                        </h3>
                                    </div>

                                    <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[400px] md:max-h-none">
                                        {loadingTimeline ? (
                                            <div className="flex justify-center py-4"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div></div>
                                        ) : timeline.length === 0 ? (
                                            <div className="text-center py-8 text-tertiary text-xs">Nenhuma atividade recente.</div>
                                        ) : (
                                            timeline.map((item) => (
                                                <div key={item.id} className="flex gap-2.5 text-sm animate-fade-in text-left">
                                                    <div className="flex-1">
                                                        <div className="flex items-center justify-between mb-1">
                                                            <span className={`text-xs font-medium ${item.type === 'comment' ? 'text-primary' : 'text-secondary italic'}`}>
                                                                {item.type === 'comment' ? (item.profissionais?.nome || 'Você') : 'Sistema'}
                                                            </span>
                                                            <span className="text-[9px] text-tertiary uppercase">
                                                                {new Date(item.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                                            </span>
                                                        </div>
                                                        <div className={`p-2.5 rounded-lg text-xs leading-relaxed ${item.type === 'comment'
                                                            ? 'bg-white shadow-sm border border-gray-100 text-secondary'
                                                            : 'text-tertiary italic border-l-2 border-gray-200 pl-2'
                                                            }`}>
                                                            {item.type === 'comment' ? item.content : item.event}
                                                        </div>
                                                    </div>
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
