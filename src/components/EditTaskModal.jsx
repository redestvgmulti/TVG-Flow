import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Trash2, AlertTriangle, Plus, FileText, Link as LinkIcon, Calendar } from 'lucide-react'
import { toast } from 'sonner'
import { updateOS, cancelOS, getActiveProfessionals } from '../services/taskService'
import { supabase } from '../services/supabase'
import { useFocusTrap } from '../hooks/useFocusTrap'

export default function EditTaskModal({ task, isOpen, onClose, onSuccess, currentUserId, onCancelRequest }) {
    if (!isOpen || !task) return null

    const modalRef = useRef(null)
    const [loading, setLoading] = useState(false)
    const [professionals, setProfessionals] = useState([])
    const [formData, setFormData] = useState({
        titulo: '',
        descricao: '',
        deadline: '',
        drive_link: '',
    })

    // Workflow State
    const [isWorkflow, setIsWorkflow] = useState(false)
    const [microTasks, setMicroTasks] = useState([]) // Current state of micro tasks
    const [attachments, setAttachments] = useState([])
    const [removedAttachmentIds, setRemovedAttachmentIds] = useState([])

    // Actions tracking
    const [addedMicroTasks, setAddedMicroTasks] = useState([]) // New ones
    const [removedMicroTaskIds, setRemovedMicroTaskIds] = useState([]) // Deleted ones

    useEffect(() => {
        if (isOpen) {
            loadInitialData()
        }
    }, [isOpen, task])

    async function loadInitialData() {
        console.log('EditTaskModal: Loading initial data for task', task.id)
        setLoading(true)
        try {
            const [profsData, freshTaskData] = await Promise.all([
                getActiveProfessionals(),
                fetchFreshTask(task.id)
            ])
            setProfessionals(profsData || [])

            if (freshTaskData) {
                // Determine Type
                const hasMicroTasks = freshTaskData.micro_tasks && freshTaskData.micro_tasks.length > 0
                setIsWorkflow(hasMicroTasks)

                // Set Form Data
                setFormData({
                    titulo: freshTaskData.titulo,
                    descricao: freshTaskData.descricao || '',
                    deadline: freshTaskData.deadline ? new Date(freshTaskData.deadline).toISOString().slice(0, 16) : '',
                    drive_link: freshTaskData.drive_link || ''
                })

                // Set Workflow Data
                if (hasMicroTasks) {
                    setMicroTasks(freshTaskData.micro_tasks.filter(mt => mt.ativo !== false))
                } else {
                    setMicroTasks([])
                }

                // Fetch Attachments (if needed) - usually fetched separately or joined? 
                // Let's assume we fetch them if it's a workflow/admin thing
                const { data: files } = await supabase
                    .from('task_attachments')
                    .select('*')
                    .eq('tarefa_id', freshTaskData.id)
                    .is('removed_at', null)
                setAttachments(files || [])
            }
        } catch (error) {
            console.error('Error loading edit data:', error)
            toast.error(`Erro ao carregar: ${error.message}`)
            // onClose() // Don't close so we can see the error
        } finally {
            setLoading(false)
        }
    }

    async function fetchFreshTask(id) {
        const { data, error } = await supabase
            .from('tarefas')
            .select(`
                *,
                micro_tasks:tarefas_micro (
                    id, status, funcao, profissional_id, peso, ativo,
                    profissionais (id, nome)
                )
            `)
            .eq('id', id)
            .single()
        if (error) throw error
        return data
    }

    async function handleSave(e) {
        e.preventDefault()
        setLoading(true)

        try {
            const payload = {
                titulo: formData.titulo,
                descricao: formData.descricao,
                deadline: formData.deadline,
                drive_link: formData.drive_link
            }

            // Auto-update status if deadline is moved to future
            if (formData.deadline) {
                const newDeadline = new Date(formData.deadline)
                const now = new Date()
                if (newDeadline > now && task.status === 'atrasada') {
                    payload.status = 'pendente'
                    // removed_at? finished_at? no, just status reset.
                    // Ideally the backend or cron handles this, but client-side override is requested.
                }
            }

            // Workflow specific payload
            if (isWorkflow) {
                if (addedMicroTasks.length > 0) {
                    payload.add_micro_tasks = addedMicroTasks
                }
                if (removedMicroTaskIds.length > 0) {
                    payload.remove_micro_task_ids = removedMicroTaskIds
                }
                if (removedAttachmentIds.length > 0) {
                    payload.remove_attachment_ids = removedAttachmentIds
                }
            }

            await updateOS(task.id, payload)
            toast.success('Tarefa atualizada com sucesso!')
            onSuccess()
            onClose()
        } catch (error) {
            console.error('Error updating OS:', error)
            toast.error(error.message || 'Erro ao atualizar tarefa')
        } finally {
            setLoading(false)
        }
    }

    function handleCancelOS() {
        // Trigger parent modal instead of browser confirm
        if (onCancelRequest) {
            onCancelRequest()
        }
    }

    // Micro Task Handlers
    function handleAddMicroTask() {
        // Can only add if Workflow
        if (!isWorkflow) return

        const newId = `temp_${Date.now()}`
        const newTask = {
            id: newId,
            funcao: '',
            profissional_id: '',
            peso: 1,
            isNew: true
        }

        setAddedMicroTasks([...addedMicroTasks, newTask])
    }

    function handleRemoveMicroTask(id, isNew) {
        if (isNew) {
            setAddedMicroTasks(addedMicroTasks.filter(mt => mt.id !== id))
        } else {
            // Check status first
            const mt = microTasks.find(m => m.id === id)
            if (mt && (mt.status === 'em_execucao' || mt.status === 'concluida')) {
                toast.error('Não é possível remover etapas em execução ou concluídas')
                return
            }
            setRemovedMicroTaskIds([...removedMicroTaskIds, id])
        }
    }

    function updateNewMicroTask(id, field, value) {
        setAddedMicroTasks(addedMicroTasks.map(mt => {
            if (mt.id === id) {
                return { ...mt, [field]: value }
            }
            return mt
        }))
    }

    function handleRemoveAttachment(id) {
        setRemovedAttachmentIds([...removedAttachmentIds, id])
    }

    // Render Helpers
    const combinedMicroTasks = [
        ...microTasks.filter(mt => !removedMicroTaskIds.includes(mt.id)),
        ...addedMicroTasks
    ]

    // Focus trap for accessibility
    useFocusTrap(isOpen, modalRef)

    // Close on escape key
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [onClose])

    const priorityOptions = [
        { value: 'urgent', label: 'Urgente', color: 'text-red-600' },
        { value: 'high', label: 'Alta', color: 'text-orange-500' },
        { value: 'medium', label: 'Média', color: 'text-blue-500' },
        { value: 'low', label: 'Baixa', color: 'text-gray-500' }
    ]

    return createPortal(
        <div className="modal-backdrop" onClick={onClose}>
            <div ref={modalRef} className="modal" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="modal-header">
                    <div>
                        <h3>Editar Ordem de Serviço</h3>
                        <p className="text-sm text-gray-500 mt-1">{task.empresas?.nome || 'Sem cliente associado'}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="modal-close"
                        title="Fechar (Esc)"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body */}
                <div className="modal-body">
                    {/* Title */}
                    <div className="form-group">
                        <label htmlFor="edit-title">Título</label>
                        <input
                            id="edit-title"
                            type="text"
                            value={formData.titulo}
                            onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
                            className="input"
                            placeholder="Título da tarefa"
                        />
                    </div>

                    {/* Deadline */}
                    <div className="form-group">
                        <label htmlFor="edit-deadline">Prazo (Deadline)</label>
                        <div className="relative">
                            <input
                                id="edit-deadline"
                                type="datetime-local"
                                value={formData.deadline}
                                onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                                className="input"
                            />

                        </div>
                    </div>

                    {/* Description */}
                    <div className="form-group">
                        <label htmlFor="edit-description">Descrição</label>
                        <textarea
                            id="edit-description"
                            value={formData.descricao}
                            onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                            className="input min-h-[120px]"
                            placeholder="Descreva os detalhes da tarefa..."
                        />
                    </div>

                    {/* Drive Link */}
                    <div className="form-group">
                        <label htmlFor="edit-drive-link" className="flex items-center gap-2">
                            <LinkIcon size={14} />
                            Link do Drive
                        </label>
                        <input
                            id="edit-drive-link"
                            type="url"
                            value={formData.drive_link}
                            onChange={(e) => setFormData({ ...formData, drive_link: e.target.value })}
                            className="input"
                            placeholder="https://drive.google.com/..."
                        />
                    </div>

                    {/* Workflow Editor */}
                    {isWorkflow && (
                        <div className="border-t border-gray-100 pt-6">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-md font-semibold text-gray-800 flex items-center gap-2">
                                    <FileText size={16} /> Micro Tarefas
                                </h3>
                                <button
                                    type="button"
                                    onClick={handleAddMicroTask}
                                    className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                                >
                                    <Plus size={16} /> Adicionar Etapa
                                </button>
                            </div>

                            <div className="space-y-3">
                                {combinedMicroTasks.length === 0 && (
                                    <p className="text-sm text-gray-400 italic">Nenhuma micro-tarefa ativa.</p>
                                )}
                                {combinedMicroTasks.map((mt, idx) => (
                                    <div key={mt.id} className="p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-between gap-3">
                                        <div className="flex-1 grid grid-cols-2 gap-3">
                                            {mt.isNew ? (
                                                <>
                                                    <input
                                                        placeholder="Função (ex: Editor)"
                                                        className="text-sm p-1 border rounded"
                                                        value={mt.funcao}
                                                        onChange={e => updateNewMicroTask(mt.id, 'funcao', e.target.value)}
                                                    />
                                                    <select
                                                        className="text-sm p-1 border rounded"
                                                        value={mt.profissional_id}
                                                        onChange={e => updateNewMicroTask(mt.id, 'profissional_id', e.target.value)}
                                                    >
                                                        <option value="">Selecione...</option>
                                                        {professionals.map(p => (
                                                            <option key={p.id} value={p.id}>{p.nome}</option>
                                                        ))}
                                                    </select>
                                                </>
                                            ) : (
                                                <div className="text-sm">
                                                    <span className="font-medium text-gray-700 block">{mt.funcao}</span>
                                                    <span className="text-gray-500">{mt.profissionais?.nome || '...'}</span>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {!mt.isNew && (
                                                <span className={`text-xs px-2 py-1 rounded-full ${mt.status === 'concluida' ? 'bg-green-100 text-green-700' :
                                                    mt.status === 'em_execucao' ? 'bg-blue-100 text-blue-700' :
                                                        'bg-gray-200 text-gray-700'
                                                    }`}>
                                                    {mt.status}
                                                </span>
                                            )}

                                            <button
                                                type="button"
                                                onClick={() => handleRemoveMicroTask(mt.id, mt.isNew)}
                                                className="text-red-500 hover:text-red-700 p-1"
                                                title={(!mt.isNew && (mt.status === 'em_execucao' || mt.status === 'concluida')) ? 'Bloqueado' : 'Remover'}
                                                disabled={!mt.isNew && (mt.status === 'em_execucao' || mt.status === 'concluida')}
                                            >
                                                <Trash2 size={16} className={(!mt.isNew && (mt.status === 'em_execucao' || mt.status === 'concluida')) ? 'opacity-30' : ''} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Attachments Editor */}
                    {isWorkflow && attachments.length > 0 && (
                        <div className="border-t border-gray-100 pt-6">
                            <h3 className="text-md font-semibold text-gray-800 mb-3">Anexos</h3>
                            <div className="space-y-2">
                                {attachments.filter(f => !removedAttachmentIds.includes(f.id)).map(file => (
                                    <div key={file.id} className="flex justify-between items-center p-2 bg-white border rounded">
                                        <span className="text-sm truncate max-w-[200px]">{file.original_filename}</span>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveAttachment(file.id)}
                                            className="text-red-500 hover:text-red-700 text-xs"
                                        >
                                            Remover
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Danger Zone */}
                    <div className="mt-8 p-4 bg-red-50 rounded-lg border border-red-100">
                        <div className="flex justify-between items-center">
                            <div>
                                <h4 className="text-sm font-bold text-red-700 flex items-center gap-2">
                                    <AlertTriangle size={16} /> Zona de Perigo
                                </h4>
                                <p className="text-xs text-red-600 mt-1">O cancelamento é irreversível (arquivamento).</p>
                            </div>
                            <button
                                type="button"
                                onClick={handleCancelOS}
                                className="px-4 py-2 bg-white text-red-600 border border-red-200 rounded-md hover:bg-red-50 hover:border-red-300 text-sm font-medium transition-colors shadow-sm"
                            >
                                Cancelar OS
                            </button>
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="modal-footer">
                    <button
                        type="button"
                        onClick={onClose}
                        className="btn btn-secondary"
                        disabled={loading}
                    >
                        Fechar
                    </button>
                    <button
                        onClick={handleSave}
                        className="btn btn-primary"
                        disabled={loading}
                    >
                        {loading ? 'Salvando...' : 'Salvar Alterações'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}
