import { useState, useEffect } from 'react'
import { ArrowLeft, Clock, CheckCircle2, AlertCircle, Lock, RotateCcw, User } from 'lucide-react'
import { supabase } from '../services/supabase'
import { toast } from 'sonner'
import '../styles/macro-task.css'

export default function MacroTaskDetail({ taskId, onBack }) {
    const [macroTask, setMacroTask] = useState(null)
    const [microTasks, setMicroTasks] = useState([])
    const [logs, setLogs] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (taskId) {
            loadMacroTaskData()
        }
    }, [taskId])

    async function loadMacroTaskData() {
        try {
            setLoading(true)

            // Load macro task
            const { data: macro, error: macroError } = await supabase
                .from('tarefas')
                .select('*')
                .eq('id', taskId)
                .single()

            if (macroError) throw macroError

            // Load micro tasks
            const { data: micro, error: microError } = await supabase
                .from('tarefas_micro')
                .select(`
                    *,
                    profissionais:profissional_id (
                        id,
                        nome
                    )
                `)
                .eq('tarefa_id', taskId)
                .order('created_at', { ascending: true })

            if (microError) throw microError

            // Load logs
            const microTaskIds = micro?.map(mt => mt.id) || []
            let allLogs = []

            if (microTaskIds.length > 0) {
                const { data: logsData, error: logsError } = await supabase
                    .from('tarefas_micro_logs')
                    .select(`
                        *,
                        from_profissional:from_profissional_id (nome),
                        to_profissional:to_profissional_id (nome)
                    `)
                    .in('tarefa_micro_id', microTaskIds)
                    .order('created_at', { ascending: false })

                if (!logsError) {
                    allLogs = logsData || []
                }
            }

            setMacroTask(macro)
            setMicroTasks(micro || [])
            setLogs(allLogs)

        } catch (error) {
            console.error('Error loading macro task:', error)
            toast.error('Erro ao carregar detalhes da tarefa')
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="macro-task-loading">
                <div className="spinner"></div>
                <p>Carregando...</p>
            </div>
        )
    }

    if (!macroTask) {
        return (
            <div className="macro-task-error">
                <AlertCircle size={48} />
                <p>Tarefa não encontrada</p>
                <button onClick={onBack} className="btn-back">Voltar</button>
            </div>
        )
    }

    const totalWeight = microTasks.reduce((sum, mt) => sum + (mt.peso || 1), 0)
    const completedWeight = microTasks
        .filter(mt => mt.status === 'concluida')
        .reduce((sum, mt) => sum + (mt.peso || 1), 0)
    const progress = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0

    return (
        <div className="macro-task-container">
            {/* Header */}
            <div className="macro-task-header">
                <button onClick={onBack} className="macro-task-back-btn">
                    <ArrowLeft size={20} />
                </button>
                <div className="macro-task-header-content">
                    <h1 className="macro-task-title">{macroTask.titulo}</h1>
                    <div className="macro-task-meta">
                        <span className={`macro-task-status status-${macroTask.status}`}>
                            {macroTask.status === 'concluida' ? 'Concluída' :
                                macroTask.status === 'em_progresso' ? 'Em Andamento' : 'Pendente'}
                        </span>
                        {macroTask.deadline && (
                            <span className="macro-task-deadline">
                                <Clock size={14} />
                                {new Date(macroTask.deadline).toLocaleDateString('pt-BR')}
                            </span>
                        )}
                    </div>
                </div>
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
                {macroTask.descricao && (
                    <div className="macro-task-section">
                        <h3 className="section-title">DESCRIÇÃO</h3>
                        <p className="macro-task-description">{macroTask.descricao}</p>
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
                                            {mt.profissionais?.nome || 'Não atribuído'}
                                        </span>
                                        <span className="timeline-weight">Peso: {mt.peso}</span>
                                    </div>
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
                    {logs.length === 0 ? (
                        <p className="empty-state">Nenhuma atividade registrada ainda</p>
                    ) : (
                        <div className="activity-log">
                            {logs.map((log, index) => (
                                <div key={index} className={`log-item log-${log.acao}`}>
                                    <div className="log-icon">
                                        {log.acao === 'completed' ? <CheckCircle2 size={16} /> :
                                            log.acao === 'returned' ? <RotateCcw size={16} /> :
                                                log.acao === 'blocked' ? <Lock size={16} /> :
                                                    <Clock size={16} />}
                                    </div>
                                    <div className="log-content">
                                        <p className="log-message">
                                            {log.acao === 'created' && `Etapa criada e atribuída a ${log.to_profissional?.nome}`}
                                            {log.acao === 'started' && `${log.from_profissional?.nome} iniciou a etapa`}
                                            {log.acao === 'completed' && `${log.from_profissional?.nome} concluiu a etapa`}
                                            {log.acao === 'returned' && `${log.from_profissional?.nome} devolveu para ${log.to_profissional?.nome}`}
                                            {log.acao === 'blocked' && 'Etapa bloqueada por dependência'}
                                            {log.acao === 'unblocked' && 'Etapa desbloqueada'}
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
        </div>
    )
}
