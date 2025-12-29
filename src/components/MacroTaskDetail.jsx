import { useState, useEffect } from 'react'
import { ArrowLeft, Clock, CheckCircle2, AlertCircle, Lock, RotateCcw, User, Play, X } from 'lucide-react'
import { supabase } from '../services/supabase'
import { toast } from 'sonner'
import { useAuth } from '../contexts/AuthContext'
import { completeMicroTask, updateMicroTaskStatus, loadWorkflowProfessionals, returnMicroTask } from '../utils/taskExecution'
import ReturnReasonModal from './ReturnReasonModal'
import '../styles/macro-task.css'

export default function MacroTaskDetail({ taskId, onBack, isModal = false }) {
    const { user } = useAuth()
    const [task, setTask] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    // Return modal state
    const [showReturnModal, setShowReturnModal] = useState(false)
    const [selectedReturnTask, setSelectedReturnTask] = useState(null)
    const [professionals, setProfessionals] = useState([])
    const [activityLogs, setActivityLogs] = useState([])

    useEffect(() => {
        if (taskId) {
            fetchTaskDetails()
        }
    }, [taskId])

    async function fetchTaskDetails() {
        try {
            setLoading(true)

            // Load macro task
            const { data: macro, error: macroError } = await supabase
                .from('tarefas')
                .select(`
                    *,
                    cliente:empresas(nome)
                `)
                .eq('id', taskId)
                .single()

            if (macroError) throw macroError

            // Load micro tasks
            const { data: micro, error: microError } = await supabase
                .from('tarefas_micro')
                .select(`
                    *,
                    profissional:profissionais (
                        id,
                        nome,
                        email
                    )
                `)
                .eq('tarefa_id', taskId)
                .order('created_at', { ascending: true })

            if (microError) throw microError

            // Combine data
            const taskData = {
                ...macro,
                micro_tasks: micro || []
            }

            setTask(taskData)

            // Fetch logs
            if (micro?.length > 0) {
                const mtIds = micro.map(m => m.id)
                const { data: logs } = await supabase
                    .from('tarefas_micro_logs')
                    .select('*, from:from_profissional_id(nome), to:to_profissional_id(nome)')
                    .in('tarefa_micro_id', mtIds)
                    .order('created_at', { ascending: false })

                if (logs) {
                    const formattedLogs = logs.map(log => ({
                        ...log,
                        action: log.acao,
                        description: generateLogDescription(log)
                    }))
                    setActivityLogs(formattedLogs)
                }
            }

        } catch (err) {
            console.error('Error fetching task details:', err)
            setError('Falha ao carregar detalhes da tarefa')
        } finally {
            setLoading(false)
        }
    }

    function generateLogDescription(log) {
        const fromName = log.from?.nome || 'Sistema'
        const toName = log.to?.nome || 'Alguém'

        switch (log.acao) {
            case 'created': return `Etapa criada e atribuída a ${toName}`
            case 'started': return `${fromName} iniciou a etapa`
            case 'completed': return `${fromName} concluiu a etapa`
            case 'returned': return `${fromName} devolveu para ${toName}`
            case 'blocked': return 'Etapa bloqueada por dependência'
            case 'unblocked': return 'Etapa desbloqueada'
            default: return log.mensagem || 'Atividade registrada'
        }
    }

    // Execution Handlers
    async function handleStartMicroTask(microTaskId) {
        try {
            await updateMicroTaskStatus(microTaskId, 'em_execucao')
            toast.success('Tarefa iniciada!')
            fetchTaskDetails() // Refresh
        } catch (error) {
            console.error('Error starting micro task:', error)
            toast.error(error.message || 'Erro ao iniciar tarefa')
        }
    }

    async function handleCompleteMicroTask(microTaskId, currentStatus) {
        if (currentStatus === 'bloqueada') {
            toast.error('Esta tarefa está bloqueada. Aguarde a conclusão da etapa anterior.')
            return
        }

        try {
            await completeMicroTask(microTaskId)
            toast.success('Micro tarefa concluída! 🎉')
            fetchTaskDetails()
        } catch (error) {
            console.error('Error completing micro task:', error)
            toast.error(error.message || 'Erro ao concluir tarefa')
        }
    }

    async function handleOpenReturnModal(microTask) {
        setSelectedReturnTask(microTask)
        try {
            const profs = await loadWorkflowProfessionals(taskId, user.id)
            setProfessionals(profs)
            setShowReturnModal(true)
        } catch (error) {
            console.error('Error loading professionals:', error)
            toast.error('Erro ao carregar profissionais')
        }
    }

    async function handleReturnTask(payload) {
        try {
            await returnMicroTask(payload)
            toast.success('Tarefa devolvida com sucesso')
            setShowReturnModal(false)
            setSelectedReturnTask(null)
            fetchTaskDetails()
        } catch (error) {
            console.error('Error returning task:', error)
            toast.error(error.message || 'Erro ao devolver tarefa')
        }
    }

    if (loading) return (
        <div className="macro-task-container">
            <div className="macro-task-loading">
                <div className="spinner"></div>
                <p>Carregando detalhes da tarefa...</p>
            </div>
        </div>
    )

    if (error) return (
        <div className="macro-task-container">
            <div className="macro-task-error">
                <AlertCircle size={48} />
                <p>{error}</p>
                <button onClick={onBack} className="macro-task-back-btn">Voltar</button>
            </div>
        </div>
    )

    if (!task) return null

    // Helper to get professional name
    const getProfessionalName = (mt) => {
        return mt.profissional?.nome || 'Não atribuído'
    }

    const microTasks = task.micro_tasks?.sort((a, b) => a.id - b.id) || []

    // Progress calculation
    const totalWeight = microTasks.reduce((sum, mt) => sum + (mt.peso || 1), 0)
    const completedWeight = microTasks
        .filter(mt => mt.status === 'concluida')
        .reduce((sum, mt) => sum + (mt.peso || 1), 0)
    const progress = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0

    return (
        <div className={`macro-task-container ${isModal ? 'is-modal' : ''}`}>
            {/* Header */}
            <div className="macro-task-header">
                {!isModal && (
                    <button onClick={onBack} className="macro-task-back-btn" title="Voltar">
                        <ArrowLeft size={20} />
                    </button>
                )}

                <div className="macro-task-header-content">
                    <div className="macro-task-meta" style={{ marginBottom: '8px' }}>
                        <span className={`macro-task-status status-${task.status}`}>
                            {task.status?.replace('_', ' ')}
                        </span>
                        <div className="macro-task-deadline">
                            <Clock size={14} />
                            {new Date(task.deadline).toLocaleDateString()}
                        </div>
                    </div>
                    <h1 className="macro-task-title">{task.titulo}</h1>
                </div>

                {isModal && (
                    <button onClick={onBack} className="macro-task-back-btn" title="Fechar">
                        <X size={20} />
                    </button>
                )}
            </div>

            {/* Progress Bar */}
            <div className="macro-task-progress-section">
                <div className="progress-header">
                    <span className="progress-label">Progresso Geral</span>
                    <span className="progress-percentage">{progress}%</span>
                </div>
                <div className="progress-bar-container">
                    <div
                        className="progress-bar-fill"
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>
                <div className="progress-stats">
                    <span>{microTasks.filter(mt => mt.status === 'concluida').length} de {microTasks.length} etapas concluídas</span>
                </div>
            </div>

            {/* Body */}
            <div className="macro-task-body">
                {/* Description */}
                {task.descricao && (
                    <div className="macro-task-section">
                        <h3 className="section-title">DESCRIÇÃO</h3>
                        <p className="macro-task-description">{task.descricao}</p>
                    </div>
                )}

                {/* Workflow Timeline */}
                <div className="macro-task-section">
                    <h3 className="section-title">FLUXO DE TRABALHO</h3>
                    <div className="workflow-timeline">
                        {microTasks.map((mt, index) => (
                            <div key={mt.id} className={`timeline-item status-${mt.status}`}>
                                <div className="timeline-marker">
                                    {mt.status === 'concluida' ? <CheckCircle2 size={20} /> :
                                        mt.status === 'bloqueada' ? <Lock size={20} /> :
                                            mt.status === 'devolvida' ? <RotateCcw size={20} /> :
                                                <div className="timeline-dot"></div>}
                                </div>
                                <div className="timeline-content">
                                    <div className="timeline-header">
                                        <span className="timeline-step">Etapa {index + 1}</span>
                                        <span className={`timeline-status status-${mt.status}`}>
                                            {mt.status === 'concluida' ? 'Concluída' :
                                                mt.status === 'bloqueada' ? 'Bloqueada' :
                                                    mt.status === 'devolvida' ? 'Devolvida' :
                                                        mt.status === 'em_execucao' ? 'Em Execução' : 'Pendente'}
                                        </span>
                                    </div>
                                    <div className="timeline-info">
                                        <span className="timeline-function">{mt.funcao}</span>
                                        <span className="timeline-professional">
                                            <User size={14} />
                                            {getProfessionalName(mt)}
                                        </span>
                                        <span className="timeline-weight">Peso: {mt.peso}</span>
                                    </div>

                                    {/* Action buttons for assigned tasks */}
                                    {mt.profissional_id === user?.id && mt.status !== 'concluida' && (
                                        <div className="timeline-actions">
                                            {mt.status === 'pendente' && (
                                                <button
                                                    onClick={() => handleStartMicroTask(mt.id)}
                                                    className="btn-micro-action btn-start"
                                                >
                                                    <Play size={14} />
                                                    Iniciar
                                                </button>
                                            )}
                                            {(mt.status === 'em_execucao' || mt.status === 'devolvida') && (
                                                <>
                                                    <button
                                                        onClick={() => handleCompleteMicroTask(mt.id, mt.status)}
                                                        className="btn-micro-action btn-complete"
                                                    >
                                                        <CheckCircle2 size={14} />
                                                        Concluir
                                                    </button>
                                                    <button
                                                        onClick={() => handleOpenReturnModal(mt)}
                                                        className="btn-micro-action btn-return"
                                                    >
                                                        <RotateCcw size={14} />
                                                        Solicitar Ajuste
                                                    </button>
                                                </>
                                            )}
                                            {mt.status === 'bloqueada' && (
                                                <div className="timeline-blocked-message">
                                                    <Lock size={12} />
                                                    <span>Aguardando etapa anterior</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                {index < microTasks.length - 1 && (
                                    <div className="timeline-connector"></div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Activity Log */}
                <div className="macro-task-section">
                    <h3 className="section-title">HISTÓRICO DE ATIVIDADES</h3>
                    {activityLogs.length === 0 ? (
                        <p className="empty-state">Nenhuma atividade registrada ainda</p>
                    ) : (
                        <div className="activity-log">
                            {activityLogs.map((log, index) => (
                                <div key={index} className={`log-item log-${log.action}`}>
                                    <div className="log-icon">
                                        {log.action === 'completed' ? <CheckCircle2 size={16} /> :
                                            log.action === 'returned' ? <RotateCcw size={16} /> :
                                                log.action === 'blocked' ? <Lock size={16} /> :
                                                    <Clock size={16} />}
                                    </div>
                                    <div className="log-content">
                                        <p className="log-message">
                                            {log.description}
                                        </p>
                                        {log.motivo && (
                                            <p className="log-reason">Motivo: {log.motivo}</p>
                                        )}
                                        <span className="log-timestamp">
                                            {new Date(log.created_at).toLocaleString('pt-BR')}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Return Modal */}
            {showReturnModal && selectedReturnTask && (
                <ReturnReasonModal
                    microTask={selectedReturnTask}
                    professionals={professionals}
                    onClose={() => {
                        setShowReturnModal(false)
                        setSelectedReturnTask(null)
                    }}
                    onSubmit={handleReturnTask}
                />
            )}
        </div>
    )
}
