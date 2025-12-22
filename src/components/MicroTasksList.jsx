import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { Users, CheckCircle, Clock, Link as LinkIcon } from 'lucide-react'
import { toast } from 'sonner'
import '../styles/microTasks.css'

function MicroTasksList({ taskId, isAdmin = false, currentUserId = null }) {
    const [microTasks, setMicroTasks] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (taskId) {
            fetchMicroTasks()
        }
    }, [taskId])

    async function fetchMicroTasks() {
        try {
            setLoading(true)

            // FIX 1: Use profissionais table instead of usuarios
            const { data, error } = await supabase
                .from('tarefas_itens')
                .select(`
                    *,
                    profissionais (
                        id,
                        nome,
                        email
                    )
                `)
                .eq('tarefa_id', taskId)
                .order('created_at')

            if (error) throw error
            setMicroTasks(data || [])

        } catch (error) {
            console.error('Error fetching micro-tasks:', error)
        } finally {
            setLoading(false)
        }
    }

    // FIX 4: Professional completes their own task, Admin can only reopen
    async function handleToggleStatus(microTaskId, currentStatus, professionalId) {
        try {
            // Only allow professional to complete their own task
            if (currentStatus === 'pendente' && !isAdmin && professionalId !== currentUserId) {
                toast.error('Você só pode concluir suas próprias tarefas')
                return
            }

            // Admin can only reopen (set to pendente)
            if (isAdmin && currentStatus === 'pendente') {
                toast.error('Apenas o profissional pode concluir sua tarefa')
                return
            }

            const newStatus = currentStatus === 'concluida' ? 'pendente' : 'concluida'

            const { error } = await supabase
                .from('tarefas_itens')
                .update({ status: newStatus })
                .eq('id', microTaskId)

            if (error) throw error

            toast.success(newStatus === 'concluida' ? 'Micro-tarefa concluída' : 'Micro-tarefa reaberta')
            fetchMicroTasks()

        } catch (error) {
            console.error('Error updating micro-task:', error)
            toast.error('Erro ao atualizar micro-tarefa')
        }
    }

    if (loading) {
        return (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                Carregando micro-tarefas...
            </div>
        )
    }

    if (microTasks.length === 0) {
        return (
            <div className="micro-tasks-empty">
                <div className="micro-tasks-empty-icon">
                    <Users size={48} />
                </div>
                <p className="micro-tasks-empty-text">
                    Nenhum profissional atribuído a esta tarefa
                </p>
            </div>
        )
    }

    const completedCount = microTasks.filter(mt => mt.status === 'concluida').length
    const totalCount = microTasks.length
    const progressPercent = (completedCount / totalCount) * 100

    return (
        <div>
            {/* Progress Indicator */}
            <div className="micro-tasks-progress">
                <div className="micro-tasks-progress-bar">
                    <div
                        className="micro-tasks-progress-fill"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>
                <span className="micro-tasks-progress-text">
                    {completedCount}/{totalCount} concluídas
                </span>
            </div>

            {/* Micro-Tasks List */}
            <div className="micro-tasks-list">
                {microTasks.map(microTask => {
                    const isProfessionalOwner = !isAdmin && microTask.profissional_id === currentUserId
                    const canComplete = isProfessionalOwner && microTask.status === 'pendente'
                    const canReopen = (isAdmin || isProfessionalOwner) && microTask.status === 'concluida'

                    return (
                        <div
                            key={microTask.id}
                            className={`micro-task-card ${microTask.status === 'concluida' ? 'completed' : ''}`}
                        >
                            <div className="micro-task-header">
                                <div className="micro-task-professional">
                                    <Users size={16} />
                                    <p className="micro-task-professional-name">
                                        {microTask.profissionais.nome}
                                    </p>
                                </div>
                                <span className={`micro-task-status-badge ${microTask.status}`}>
                                    {microTask.status === 'concluida' ? (
                                        <>
                                            <CheckCircle size={14} /> Concluída
                                        </>
                                    ) : (
                                        <>
                                            <Clock size={14} /> Pendente
                                        </>
                                    )}
                                </span>
                            </div>

                            <div className="micro-task-body">
                                {microTask.entrega_link && (
                                    <div className="micro-task-link">
                                        <LinkIcon size={14} />
                                        <a href={microTask.entrega_link} target="_blank" rel="noopener noreferrer">
                                            Link de Entrega
                                        </a>
                                    </div>
                                )}

                                {microTask.observacoes && (
                                    <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: 0 }}>
                                        {microTask.observacoes}
                                    </p>
                                )}

                                {microTask.concluida_at && (
                                    <p style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', margin: '4px 0 0 0' }}>
                                        Concluída em: {new Date(microTask.concluida_at).toLocaleString('pt-BR')}
                                    </p>
                                )}
                            </div>

                            {/* FIX 4: Conditional buttons based on role and ownership */}
                            {(canComplete || canReopen) && (
                                <div className="micro-task-actions">
                                    {canComplete && (
                                        <button
                                            onClick={() => handleToggleStatus(microTask.id, microTask.status, microTask.profissional_id)}
                                            className="btn btn-success"
                                            style={{ fontSize: '13px', padding: '6px 12px' }}
                                        >
                                            Marcar como Concluída
                                        </button>
                                    )}
                                    {canReopen && (
                                        <button
                                            onClick={() => handleToggleStatus(microTask.id, microTask.status, microTask.profissional_id)}
                                            className="btn btn-secondary"
                                            style={{ fontSize: '13px', padding: '6px 12px' }}
                                        >
                                            Reabrir
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

export default MicroTasksList
