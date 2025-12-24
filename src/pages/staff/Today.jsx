import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from 'sonner'
import { CheckCircle2, AlertCircle, Calendar, Clock, ArrowRight } from 'lucide-react'

function Today() {
    const { professionalId, professionalName } = useAuth()
    const [tasks, setTasks] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (professionalId) {
            fetchTodayTasks()
        }
    }, [professionalId])

    async function fetchTodayTasks() {
        try {
            setLoading(true)

            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const todayStr = today.toISOString()

            const { data, error } = await supabase
                .from('tarefas')
                .select('id, titulo, deadline, status, priority, drive_link')
                .eq('assigned_to', professionalId)
                .or(`deadline.gte.${todayStr},and(deadline.lt.${todayStr},status.neq.completed)`)
                .order('deadline')

            if (error) throw error

            // Sort: overdue first, then by deadline
            const sortedTasks = (data || []).sort((a, b) => {
                const aOverdue = new Date(a.deadline) < today && a.status !== 'completed'
                const bOverdue = new Date(b.deadline) < today && b.status !== 'completed'

                if (aOverdue && !bOverdue) return -1
                if (!aOverdue && bOverdue) return 1

                return new Date(a.deadline) - new Date(b.deadline)
            })

            setTasks(sortedTasks)
        } catch (error) {
            console.error('Error fetching today tasks:', error)
            toast.error('Erro ao carregar tarefas')
        } finally {
            setLoading(false)
        }
    }

    async function handleQuickComplete(taskId, taskTitle) {
        // Optimistic UI update could be added here, but for safety we wait
        const promise = supabase
            .from('tarefas')
            .update({
                status: 'completed',
                completed_at: new Date().toISOString()
            })
            .eq('id', taskId)

        toast.promise(promise, {
            loading: 'Concluindo tarefa...',
            success: () => {
                fetchTodayTasks()
                return 'Tarefa concluída! 🎉'
            },
            error: 'Erro ao concluir tarefa'
        })
    }

    function getPriorityColor(priority) {
        switch (priority) {
            case 'urgent': return 'text-red-600 bg-red-50 border-red-100'
            case 'high': return 'text-orange-600 bg-orange-50 border-orange-100'
            case 'medium': return 'text-yellow-600 bg-yellow-50 border-yellow-100'
            default: return 'text-gray-600 bg-gray-50 border-gray-100'
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-8 h-64 text-gray-400">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4"></div>
                <p>Carregando seu dia...</p>
            </div>
        )
    }

    return (
        <div className="pb-24 px-4 pt-6 max-w-lg mx-auto">
            {/* Header */}
            <div className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-1">Hoje, {professionalName ? professionalName.split(' ')[0] : 'Colaborador'}</h2>
                <p className="text-gray-500 text-sm">Foco total nas prioridades do dia.</p>
            </div>

            {tasks.length === 0 ? (
                <div className="text-center py-12 px-6 bg-gray-50 rounded-2xl border border-gray-100 border-dashed">
                    <div className="text-4xl mb-4">🎉</div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Tudo limpo!</h3>
                    <p className="text-gray-500 text-sm">Nenhuma tarefa pendente para hoje.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {tasks.map(task => {
                        const isOverdue = new Date(task.deadline) < new Date() && task.status !== 'completed'
                        
                        return (
                            <div 
                                key={task.id} 
                                className={`
                                    relative overflow-hidden bg-white rounded-xl border p-4 transition-all active:scale-[0.98]
                                    ${isOverdue ? 'border-red-200 bg-red-50/30' : 'border-gray-200 shadow-sm'}
                                `}
                            >
                                <div className="flex items-start justify-between gap-4 mb-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1.5 align-baseline">
                                            {task.priority !== 'low' && (
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide ${getPriorityColor(task.priority)}`}>
                                                    {task.priority === 'urgent' ? 'Urgente' : task.priority === 'high' ? 'Alta' : 'Média'}
                                                </span>
                                            )}
                                            {isOverdue && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 flex items-center gap-1">
                                                    <AlertCircle size={10} /> Atrasada
                                                </span>
                                            )}
                                        </div>
                                        <h3 className="font-semibold text-gray-900 leading-tight">
                                            {task.titulo}
                                        </h3>
                                    </div>
                                </div>

                                <div className="flex items-center justify-between mt-4">
                                    <div className="flex items-center gap-3 text-xs text-gray-500">
                                        <div className={`flex items-center gap-1.5 ${isOverdue ? 'text-red-600 font-medium' : ''}`}>
                                            <Clock size={14} />
                                            <span>
                                                {new Date(task.deadline).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        {task.drive_link && (
                                            <a 
                                                href={task.drive_link} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <span>Anexo</span>
                                                <ArrowRight size={10} className="-rotate-45" />
                                            </a>
                                        )}
                                    </div>

                                    {task.status !== 'completed' && (
                                        <button
                                            onClick={() => handleQuickComplete(task.id, task.titulo)}
                                            className="
                                                flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg 
                                                hover:bg-gray-800 active:bg-gray-950 transition-colors shadow-lg shadow-gray-200
                                                touch-manipulation
                                            "
                                        >
                                            <CheckCircle2 size={16} />
                                            <span>Concluir</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

export default Today
