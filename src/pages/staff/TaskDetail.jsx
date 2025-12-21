import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import {
    ArrowLeft,
    Calendar,
    Clock,
    AlertTriangle,
    CheckCircle2,
    FileText,
    ExternalLink,
    MessageSquare,
    Send,
    History
} from 'lucide-react'
import { toast } from 'sonner'

export default function StaffTaskDetail() {
    const { id } = useParams()
    const navigate = useNavigate()
    const { user, professionalName } = useAuth()

    const [task, setTask] = useState(null)
    const [loading, setLoading] = useState(true)
    const [status, setStatus] = useState('')
    const [updating, setUpdating] = useState(false)

    // Timeline State
    const [timeline, setTimeline] = useState([])
    const [loadingTimeline, setLoadingTimeline] = useState(true)
    const [newComment, setNewComment] = useState('')
    const [sendingComment, setSendingComment] = useState(false)

    useEffect(() => {
        if (id) {
            fetchTaskDetails()
            fetchTimeline()
        }
    }, [id])

    async function fetchTaskDetails() {
        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('tarefas')
                .select('*')
                .eq('id', id)
                .single()

            if (error) throw error
            setTask(data)
            setStatus(data.status)
        } catch (error) {
            console.error('Error fetching task:', error)
            toast.error('Erro ao carregar tarefa ou acesso negado')
            navigate('/staff/tasks')
        } finally {
            setLoading(false)
        }
    }

    async function fetchTimeline() {
        try {
            setLoadingTimeline(true)

            // 1. Fetch Comments
            const { data: comments, error: commentsError } = await supabase
                .from('task_comments')
                .select('id, content, created_at, author_id, profissionais(nome)')
                .eq('task_id', id)
                .order('created_at', { ascending: true })

            if (commentsError) throw commentsError

            // 2. Fetch History
            const { data: history, error: historyError } = await supabase
                .from('task_history')
                .select('id, event, created_at')
                .eq('task_id', id)
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
            // Silent error as requested, but we could log it
        } finally {
            setLoadingTimeline(false)
        }
    }

    async function handleStatusChange(newStatus) {
        setUpdating(true)
        try {
            const updates = {
                status: newStatus,
                completed_at: newStatus === 'completed' ? new Date().toISOString() : null
            }

            const { error } = await supabase
                .from('tarefas')
                .update(updates)
                .eq('id', id)

            if (error) throw error

            setStatus(newStatus)
            setTask(prev => ({ ...prev, ...updates }))

            // Refresh timeline to see auto-generated history
            setTimeout(fetchTimeline, 500)

            if (newStatus === 'completed') {
                toast.success('Tarefa concluída! Bom trabalho 🎉')
                navigate('/staff/dashboard')
            } else {
                toast.success('Status atualizado')
            }

        } catch (error) {
            console.error('Error updating status:', error)
            toast.error('Erro ao atualizar status')
        } finally {
            setUpdating(false)
        }
    }

    async function handleSendComment(e) {
        e.preventDefault()
        if (!newComment.trim()) return

        setSendingComment(true)
        try {
            const { error } = await supabase
                .from('task_comments')
                .insert({
                    task_id: id,
                    author_id: user.id, // Auth context ensures we have the ID
                    content: newComment.trim()
                })

            if (error) throw error

            setNewComment('')
            fetchTimeline() // Refresh timeline
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

    if (!task) return null

    const isOverdue = task.deadline && new Date(task.deadline) < new Date() && status !== 'completed'

    return (
        <div className="animation-fade-in pb-12 max-w-4xl mx-auto">
            {/* Back Navigation */}
            <button
                onClick={() => navigate(-1)}
                className="group flex items-center gap-2 text-secondary hover:text-primary mb-6 transition-colors"
            >
                <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
                Voltar
            </button>

            {/* Main Content Card */}
            <div className={`card overflow-hidden border-t-8 ${status === 'completed' ? 'border-t-success' :
                    isOverdue ? 'border-t-danger' :
                        task.priority === 'urgent' ? 'border-t-danger' : 'border-t-brand'
                }`}>

                {/* Header Section */}
                <div className="p-6 md:p-8 border-b border-gray-100">
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                        <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                                {isOverdue && (
                                    <span className="badge badge-danger item-enter">
                                        <AlertTriangle size={12} className="mr-1" />
                                        Atrasada
                                    </span>
                                )}
                                <span className={`badge ${task.priority === 'urgent' ? 'badge-danger' :
                                        task.priority === 'high' ? 'badge-warning' : 'badge-neutral'
                                    }`}>
                                    Prioridade {
                                        task.priority === 'urgent' ? 'Urgente' :
                                            task.priority === 'high' ? 'Alta' :
                                                task.priority === 'medium' ? 'Média' : 'Baixa'
                                    }
                                </span>
                            </div>

                            <h1 className="text-2xl md:text-3xl font-bold text-primary mb-4 leading-tight">
                                {task.titulo}
                            </h1>

                            <div className="flex flex-wrap items-center gap-6 text-secondary text-sm">
                                {task.deadline && (
                                    <div className={`flex items-center gap-2 ${isOverdue ? 'text-danger font-semibold' : ''}`}>
                                        <Calendar size={18} className="opacity-70" />
                                        <div>
                                            <p className="text-xs text-tertiary uppercase tracking-wider mb-0.5">Prazo Final</p>
                                            <span>
                                                {new Date(task.deadline).toLocaleDateString('pt-BR')} às {new Date(task.deadline).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-center gap-2">
                                    <Clock size={18} className="opacity-70" />
                                    <div>
                                        <p className="text-xs text-tertiary uppercase tracking-wider mb-0.5">Criada em</p>
                                        <span>{new Date(task.created_at).toLocaleDateString('pt-BR')}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Status Control Box */}
                        <div className="w-full md:w-auto bg-subtle p-4 rounded-xl border border-gray-100 flex flex-col items-center gap-3">
                            <span className="text-xs font-semibold text-tertiary uppercase">Status Atual</span>

                            <select
                                value={status}
                                onChange={(e) => handleStatusChange(e.target.value)}
                                disabled={updating}
                                className={`input h-10 min-w-[180px] font-medium ${status === 'completed' ? 'text-success border-success' :
                                        'text-primary'
                                    }`}
                            >
                                <option value="pending">Pendente</option>
                                <option value="in_progress">Em andamento</option>
                                <option value="completed">Concluída</option>
                            </select>

                            {status !== 'completed' && (
                                <button
                                    onClick={() => handleStatusChange('completed')}
                                    disabled={updating}
                                    className="btn btn-success w-full text-sm py-2 gap-2"
                                >
                                    <CheckCircle2 size={16} />
                                    Concluir Tarefa
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Body Section */}
                <div className="p-6 md:p-8 grid md:grid-cols-3 gap-8">
                    {/* Main Description */}
                    <div className="md:col-span-2 space-y-8">
                        <div>
                            <h3 className="text-sm font-bold text-primary uppercase tracking-wider mb-4 border-b border-gray-100 pb-2 flex items-center gap-2">
                                <FileText size={16} />
                                Descrição
                            </h3>
                            <div className="prose prose-sm max-w-none text-secondary leading-relaxed bg-neutral-50 p-6 rounded-lg border border-neutral-100">
                                {task.descricao ? (
                                    <div className="whitespace-pre-wrap">{task.descricao}</div>
                                ) : (
                                    <p className="italic text-tertiary">Sem descrição fornecida.</p>
                                )}
                            </div>
                        </div>

                        {/* External Link */}
                        {task.drive_link && (
                            <div>
                                <h3 className="text-sm font-bold text-primary uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <ExternalLink size={16} />
                                    Arquivos Anexos
                                </h3>
                                <a
                                    href={task.drive_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="card p-4 flex items-center gap-3 hover:bg-subtle hover:border-brand-light transition-colors group"
                                >
                                    <div className="p-2 bg-blue-50 text-brand rounded-lg group-hover:bg-white transition-colors">
                                        <ExternalLink size={20} />
                                    </div>
                                    <div>
                                        <p className="font-medium text-primary text-sm group-hover:text-brand transition-colors">Abrir link da tarefa</p>
                                        <p className="text-xs text-tertiary truncate max-w-[200px] sm:max-w-md">{task.drive_link}</p>
                                    </div>
                                </a>
                            </div>
                        )}
                    </div>

                    {/* Timeline / Activity Section */}
                    <div className="md:col-span-1 flex flex-col h-full">
                        <div className="bg-subtle rounded-xl border border-gray-100 flex flex-col h-full max-h-[600px]">
                            {/* Timeline Header */}
                            <div className="p-4 border-b border-gray-100 bg-white/50 rounded-t-xl backdrop-blur-sm">
                                <h3 className="text-sm font-bold text-tertiary uppercase tracking-wider flex items-center gap-2">
                                    <History size={16} />
                                    Atividade
                                </h3>
                            </div>

                            {/* Timeline Content */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {loadingTimeline ? (
                                    <div className="text-center py-4">
                                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
                                    </div>
                                ) : timeline.length === 0 ? (
                                    <div className="text-center py-8 text-tertiary text-sm">
                                        Nenhuma atividade recente.
                                    </div>
                                ) : (
                                    timeline.map((item) => (
                                        <div key={item.id} className={`flex gap-3 text-sm animate-fade-in ${item.type === 'history' ? 'opacity-75' : ''}`}>
                                            <div className="flex-1">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className={`font-medium ${item.type === 'comment' ? 'text-primary' : 'text-secondary italic'
                                                        }`}>
                                                        {item.type === 'comment'
                                                            ? (item.profissionais?.nome || 'Usuário')
                                                            : 'Sistema'}
                                                    </span>
                                                    <span className="text-[10px] text-tertiary">
                                                        {new Date(item.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} • {new Date(item.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                <div className={`p-3 rounded-lg ${item.type === 'comment'
                                                        ? 'bg-white shadow-sm border border-gray-100 text-secondary'
                                                        : 'bg-transparent text-tertiary italic text-xs border-l-2 border-gray-200 pl-3 rounded-none'
                                                    }`}>
                                                    {item.type === 'comment' ? item.content : item.event}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Input Area */}
                            <div className="p-4 border-t border-gray-100 bg-white rounded-b-xl">
                                <form onSubmit={handleSendComment} className="relative">
                                    <textarea
                                        className="input w-full pr-10 resize-none py-3 text-sm min-h-[80px]"
                                        placeholder="Adicionar nota..."
                                        value={newComment}
                                        onChange={(e) => setNewComment(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSendComment(e);
                                            }
                                        }}
                                        disabled={sendingComment}
                                    />
                                    <button
                                        type="submit"
                                        disabled={!newComment.trim() || sendingComment}
                                        className="absolute right-3 bottom-3 text-brand hover:text-brand-dark disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                    >
                                        <Send size={18} />
                                    </button>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
