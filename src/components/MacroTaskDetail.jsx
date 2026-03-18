import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Clock, CheckCircle2, AlertCircle, Lock, RotateCcw, User, Play, X, Paperclip, Download, FileText, Trash2, ExternalLink, Edit, MoreVertical, RefreshCw } from 'lucide-react'
import { supabase } from '../services/supabase'
import { toast } from 'sonner'
import { useAuth } from '../contexts/AuthContext'
import { fileService } from '../services/fileService'
import { completeMicroTask, updateMicroTaskStatus, loadWorkflowProfessionals, returnMicroTask } from '../utils/taskExecution'
import ReturnReasonModal from './ReturnReasonModal'
import { useFocusTrap } from '../hooks/useFocusTrap'
import '../styles/macro-task.css'

export default function MacroTaskDetail({ taskId, onBack, isModal = false, onEdit, onDelete, onReopen }) {
    const { user } = useAuth()
    const detailRef = useRef(null)
    const [task, setTask] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    // Return modal state
    const [showReturnModal, setShowReturnModal] = useState(false)
    const [selectedReturnTask, setSelectedReturnTask] = useState(null)
    const [professionals, setProfessionals] = useState([])
    const [activityLogs, setActivityLogs] = useState([])

    // Attachments State
    const [attachments, setAttachments] = useState([])
    const [loadingAttachments, setLoadingAttachments] = useState(false)

    // Focus trap for accessibility when in modal mode
    useFocusTrap(isModal, detailRef)

    useEffect(() => {
        if (taskId) {
            fetchTaskDetails()
            loadAttachments()
        }
    }, [taskId])

    async function loadAttachments() {
        try {
            setLoadingAttachments(true)
            const files = await fileService.getTaskAttachments(taskId)
            setAttachments(files || [])
        } catch (error) {
            console.error('Error loading attachments:', error)
        } finally {
            setLoadingAttachments(false)
        }
    }

    async function handleDownload(file) {
        try {
            toast.loading('Preparando download...', { id: 'download' })
            const url = await fileService.getDownloadUrl(file.storage_path)

            const a = document.createElement('a')
            a.href = url
            a.download = file.original_filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)

            toast.dismiss('download')
        } catch (error) {
            console.error('Download error:', error)
            toast.error('Erro ao baixar arquivo')
        }
    }

    async function handleDeleteAttachment(fileId) {
        if (!confirm('Tem certeza que deseja excluir este anexo?')) return

        try {
            toast.loading('Excluindo...', { id: 'delete-file' })
            await fileService.deleteAttachment(fileId)

            setAttachments(prev => prev.filter(f => f.id !== fileId))
            toast.success('Arquivo excluído')
            toast.dismiss('delete-file')
        } catch (error) {
            console.error('Delete error:', error)
            toast.error('Erro ao excluir arquivo')
        }
    }

    async function fetchTaskDetails() {
        try {
            setLoading(true)

            // Load macro task
            const { data: macro, error: macroError } = await supabase
                .from('tarefas')
                .select(`
                    *,
                    cliente:empresas!cliente_id(nome)
                `)
                .eq('id', taskId)
                .single()

            if (macroError) throw macroError

            // Load micro tasks
            const { data: micro, error: microError } = await supabase
                .from('tarefas_micro')
                .select(`
                    *,
                    profissionais!profissional_id (
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
        return mt.profissionais?.nome || 'Não atribuído'
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

            {/* Body */}
            <div className="macro-task-body">
                {/* Progress Bar (Moved inside body to scroll) */}
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

                {/* Description */}
                {task.descricao && (
                    <div className="macro-task-section">
                        <h3 className="section-title">DESCRIÇÃO</h3>
                        <p className="macro-task-description">{task.descricao}</p>
                    </div>
                )}

                {/* Drive Link & Attachments */}
                {(task.drive_link || attachments.length > 0) && (
                    <div className="macro-task-section">
                        <h3 className="section-title">ARQUIVOS E LINKS</h3>

                        <div className="flex flex-col gap-3">
                            {/* Drive Link */}
                            {task.drive_link && (
                                <a
                                    href={task.drive_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-3 p-3 bg-blue-50/50 border border-blue-100 rounded-lg hover:bg-blue-50 transition-colors group"
                                >
                                    <div className="w-9 h-9 flex items-center justify-center bg-blue-100 text-blue-600 rounded-md group-hover:scale-105 transition-transform">
                                        <img src="https://upload.wikimedia.org/wikipedia/commons/1/12/Google_Drive_icon_%282020%29.svg" alt="Drive" className="w-5 h-5" />
                                    </div>
                                    <div className="flex flex-col min-w-0 flex-1">
                                        <span className="text-sm font-semibold text-slate-700 group-hover:text-blue-700 truncate">Acessar Pasta no Drive</span>
                                        <span className="text-xs text-slate-500 truncate">{task.drive_link}</span>
                                    </div>
                                    <div className="ml-auto text-blue-400 group-hover:text-blue-600">
                                        <ExternalLink size={16} />
                                    </div>
                                </a>
                            )}

                            {/* Attachments List */}
                            {attachments.length > 0 && (
                                <div className="attachments-grid">
                                    {attachments.map(file => (
                                        <div key={file.id} className="attachment-card">
                                            <div className="attachment-icon">
                                                <FileText size={20} className="text-secondary" />
                                            </div>
                                            <div className="attachment-info">
                                                <span className="attachment-name" title={file.original_filename}>
                                                    {file.original_filename}
                                                </span>
                                                <span className="attachment-size">
                                                    {(file.file_size / 1024).toFixed(0)} KB
                                                </span>
                                            </div>
                                            <div className="attachment-actions">
                                                <button
                                                    onClick={() => handleDownload(file)}
                                                    className="attachment-action-btn"
                                                    title="Baixar"
                                                >
                                                    <Download size={14} />
                                                </button>
                                                {(file.uploaded_by === user?.id || user?.role === 'admin' || user?.role === 'super_admin') && (
                                                    <button
                                                        onClick={() => handleDeleteAttachment(file.id)}
                                                        className="attachment-action-btn destructive"
                                                        title="Excluir"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Workflow Timeline - Modern Vertical Step */}
                {microTasks.length > 0 && (
                    <div className="macro-task-section">
                        <h3 className="section-title">FLUXO DE TRABALHO</h3>
                        <div className="timeline-container">
                            {microTasks.map((mt, index) => (
                                <div key={mt.id} className={`timeline-item ${mt.status === 'em_execucao' ? 'in-progress' : mt.status === 'concluida' ? 'completed' : 'pending'}`}>
                                    <div className="timeline-marker">
                                        {mt.status === 'concluida' ? <CheckCircle2 size={16} /> :
                                            mt.status === 'bloqueada' ? <Lock size={16} /> :
                                                mt.status === 'devolvida' ? <RotateCcw size={16} /> :
                                                    index + 1}
                                    </div>
                                    <div className="timeline-content">
                                        <div className="timeline-info" style={{ width: '100%' }}>
                                            <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
                                                <span className={`timeline-status-badge ${mt.status === 'em_execucao' ? 'in-progress' : mt.status}`}>
                                                    {mt.status === 'concluida' ? 'Concluída' :
                                                        mt.status === 'bloqueada' ? 'Bloqueada' :
                                                            mt.status === 'devolvida' ? 'Devolvida' :
                                                                mt.status === 'em_execucao' ? 'Em Execução' : 'Pendente'}
                                                </span>
                                                {mt.peso && <span className="text-xs text-gray-400">Peso: {mt.peso}</span>}
                                            </div>

                                            <h4 className="timeline-title">{mt.funcao}</h4>

                                            <div className="timeline-meta" style={{ marginTop: '8px' }}>
                                                <span className="timeline-assignee">
                                                    <User size={14} />
                                                    {getProfessionalName(mt)}
                                                </span>
                                            </div>

                                            {/* Action buttons for assigned tasks */}
                                            {mt.profissional_id === user?.id && mt.status !== 'concluida' && (
                                                <div className="timeline-actions" style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
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
                                                                Ajuste
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            )}

                                            {mt.status === 'bloqueada' && (
                                                <div className="timeline-blocked-message" style={{ marginTop: '8px', fontSize: '12px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <Lock size={12} />
                                                    <span>Aguardando etapa anterior</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Activity Log */}
                <div className="macro-task-section">
                    <h3 className="section-title">HISTÓRICO DE ATIVIDADES</h3>
                    {activityLogs.length === 0 ? (
                        <div className="empty-state-frame">
                            <p className="empty-state-text">Nenhuma atividade registrada ainda.</p>
                            <p className="empty-state-subtext">As ações realizadas nesta tarefa aparecerão aqui.</p>
                        </div>
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
                {/* Footer with Actions */}
                <div className="macro-task-footer">
                    <div className="flex items-center gap-2 ml-auto">
                        {task.status === 'cancelada' && onReopen && (
                            <button
                                onClick={onReopen}
                                className="btn btn-secondary flex items-center gap-2"
                                title="Reabrir OS"
                            >
                                <RefreshCw size={16} /> Reabrir
                            </button>
                        )}

                        {onEdit && (
                            <button
                                onClick={onEdit}
                                className="btn btn-secondary flex items-center gap-2"
                                title="Editar OS"
                            >
                                <Edit size={16} /> Editar
                            </button>
                        )}

                        {onDelete && (
                            <button
                                onClick={onDelete}
                                className="btn btn-danger-outline flex items-center gap-2"
                                title="Excluir OS"
                            >
                                <Trash2 size={16} /> Excluir
                            </button>
                        )}
                    </div>
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
