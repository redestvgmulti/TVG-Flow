import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import {
    ArrowLeft,
    Calendar,
    Clock,
    AlertTriangle,
    CheckCircle2,
    FileText,
    ExternalLink,
    MessageSquare,
    Save
} from 'lucide-react'
import { toast } from 'sonner' // Assuming sonner is installed as per App.jsx

export default function StaffTaskDetail() {
    const { id } = useParams()
    const navigate = useNavigate()

    const [task, setTask] = useState(null)
    const [loading, setLoading] = useState(true)
    const [status, setStatus] = useState('') // Local state for immediate UI feedback
    const [updating, setUpdating] = useState(false)

    useEffect(() => {
        if (id) fetchTaskDetails()
    }, [id])

    async function fetchTaskDetails() {
        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('tarefas')
                .select('*')
                .eq('id', id)
                .single() // We can use .single() here because RLS will ensure it fails if not authorized

            if (error) throw error
            setTask(data)
            setStatus(data.status)
        } catch (error) {
            console.error('Error fetching task:', error)
            toast.error('Erro ao carregar tarefa or acesso negado')
            navigate('/staff/tasks')
        } finally {
            setLoading(false)
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

            if (newStatus === 'completed') {
                toast.success('Tarefa concluída! Bom trabalho 🎉')
                navigate('/staff/dashboard') // Redirect to Dashboard on completion to foster flow
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

                    {/* Sidebar / Additional Info */}
                    <div className="md:col-span-1 space-y-6">
                        {/* Comments Placeholder - Block 5 */}
                        <div className="bg-subtle rounded-xl p-5 border border-dashed border-gray-200">
                            <h3 className="text-sm font-bold text-tertiary uppercase tracking-wider mb-4 flex items-center gap-2">
                                <MessageSquare size={16} />
                                Observações
                            </h3>
                            <div className="text-center py-6">
                                <p className="text-sm text-tertiary mb-3">Comentários ainda não estão disponíveis.</p>
                                <button className="btn btn-sm btn-outline-secondary w-full opacity-50 cursor-not-allowed">
                                    Adicionar Nota
                                </button>
                            </div>
                        </div>

                        {/* Tips */}
                        <div className="bg-blue-50 rounded-xl p-5 border border-blue-100">
                            <h4 className="font-semibold text-brand-dark mb-2 text-sm">Dica CityOS</h4>
                            <p className="text-xs text-blue-800 leading-relaxed">
                                Mantenha o status atualizado para que seu gestor saiba o progresso sem precisar perguntar.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
