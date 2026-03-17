import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Trash2, AlertTriangle, Plus, FileText, Link as LinkIcon, Calendar } from 'lucide-react'
import { toast } from 'sonner'
import { updateOS, cancelOS, getActiveProfessionals } from '../services/taskService'
import { supabase } from '../services/supabase'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { usePermission } from '../hooks/usePermission'

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

    // Permissions
    const { canUpdateOS } = usePermission()
    const [canEdit, setCanEdit] = useState(false)
    const [checkingPermissions, setCheckingPermissions] = useState(true)

    useEffect(() => {
        if (isOpen) {
            loadInitialData()
        }
    }, [isOpen, task])

    async function loadInitialData() {

        setLoading(true)
        try {
            const [profsData, freshTaskData, permissionResult] = await Promise.all([
                getActiveProfessionals(),
                fetchFreshTask(task.id),
                canUpdateOS(task.id)
            ])
            setProfessionals(profsData || [])
            setCanEdit(permissionResult)
            setCheckingPermissions(false)

            if (!permissionResult) {
                // Optional: Toast warning
                // toast.error('Você tem permissão apenas para leitura.')
            }

            if (freshTaskData) {
                // Determine Type
                const hasMicroTasks = freshTaskData.micro_tasks && freshTaskData.micro_tasks.length > 0
                setIsWorkflow(hasMicroTasks)

                // Set Form Data
                // Helper to format date for datetime-local input (YYYY-MM-DDTHH:MM) in LOCAL time
                let formattedDeadline = ''
                if (freshTaskData.deadline) {
                    const date = new Date(freshTaskData.deadline)
                    // Adjust to local timezone for display
                    const offset = date.getTimezoneOffset() * 60000
                    const localDate = new Date(date.getTime() - offset)
                    formattedDeadline = localDate.toISOString().slice(0, 16)
                }

                setFormData({
                    titulo: freshTaskData.titulo,
                    descricao: freshTaskData.descricao || '',
                    deadline: formattedDeadline,
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
                // deadline is handled below
                drive_link: formData.drive_link
            }

            // Validar e formatar deadline
            if (formData.deadline) {
                payload.deadline = new Date(formData.deadline).toISOString()
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
            <div ref={modalRef} className="modal modal-large" onClick={e => e.stopPropagation()} style={{ boxShadow: '0 32px 64px -16px rgba(0,0,0,0.25)', borderRadius: '24px' }}>
                
                {/* Header */}
                <div className="modal-header" style={{ padding: '24px 32px', backgroundColor: '#fff', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                    <div>
                        <h3 style={{ fontSize: '24px', fontWeight: '800', letterSpacing: '-0.02em', color: 'var(--color-text-primary)', margin: 0, lineHeight: 1.2 }}>Editar Ordem de Serviço</h3>
                        <p style={{ marginTop: '4px', fontSize: '14px', color: 'var(--color-text-secondary)', fontWeight: '500', margin: '4px 0 0 0' }}>{task.empresas?.nome || 'Sem cliente associado'}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="modal-close"
                        title="Fechar (Esc)"
                        style={{ alignSelf: 'flex-start', background: 'var(--color-bg-subtle)' }}
                    >
                        <X size={20} strokeWidth={2.5} />
                    </button>
                </div>

                {/* Body */}
                <div className="modal-body" style={{ padding: '32px', backgroundColor: '#fafafa', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    
                    {/* Title & Deadline - 2 Columns */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '20px' }}>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label htmlFor="edit-title" style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Título</label>
                            <input
                                id="edit-title"
                                type="text"
                                value={formData.titulo}
                                onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
                                className="input"
                                placeholder="Título da tarefa"
                                disabled={!canEdit}
                                style={{ padding: '14px 16px', fontSize: '15px', fontWeight: '600' }}
                            />
                        </div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label htmlFor="edit-deadline" style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prazo (Deadline)</label>
                            <input
                                id="edit-deadline"
                                type="datetime-local"
                                value={formData.deadline}
                                onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                                className="input"
                                disabled={!canEdit}
                                style={{ padding: '14px 16px', fontSize: '15px', fontWeight: '600', width: '100%' }}
                            />
                        </div>
                    </div>

                    {/* Description */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="edit-description" style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Descrição</label>
                        <textarea
                            id="edit-description"
                            value={formData.descricao}
                            onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                            className="input"
                            placeholder="Descreva os detalhes da tarefa de forma clara..."
                            disabled={!canEdit}
                            style={{ padding: '16px', fontSize: '15px', minHeight: '160px', resize: 'vertical', lineHeight: '1.6' }}
                        />
                    </div>

                    {/* Drive Link */}
                    <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="edit-drive-link" style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <LinkIcon size={14} style={{ opacity: 0.6 }}/>
                            Link de Arquivos (Drive / Notion)
                        </label>
                        <input
                            id="edit-drive-link"
                            type="url"
                            value={formData.drive_link}
                            onChange={(e) => setFormData({ ...formData, drive_link: e.target.value })}
                            className="input"
                            placeholder="https://drive.google.com/..."
                            disabled={!canEdit}
                            style={{ padding: '14px 16px', fontSize: '15px', fontWeight: '600', color: 'var(--color-primary)' }}
                        />
                    </div>

                    {/* Workflow Editor */}
                    {isWorkflow && (
                        <div style={{ marginTop: '8px', paddingTop: '32px', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                <h3 style={{ fontSize: '16px', fontWeight: '800', color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                                    <span style={{ display: 'flex', padding: '6px', backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary)', borderRadius: '8px' }}>
                                        <FileText size={16} strokeWidth={2.5} />
                                    </span>
                                    Micro Tarefas Workflow
                                </h3>
                                {canEdit && (
                                    <button
                                        type="button"
                                        onClick={handleAddMicroTask}
                                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: '700', borderRadius: '100px', backgroundColor: 'var(--color-primary-light)', color: 'var(--color-primary)', border: 'none', cursor: 'pointer', transition: 'all 0.2s' }}
                                    >
                                        <Plus size={16} strokeWidth={3} /> Nova Etapa
                                    </button>
                                )}
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {combinedMicroTasks.length === 0 && (
                                    <div style={{ padding: '32px 24px', textAlign: 'center', backgroundColor: '#fff', border: '1px dashed var(--color-border)', borderRadius: '12px' }}>
                                        <p style={{ fontSize: '14px', fontWeight: '500', color: 'var(--color-text-tertiary)', margin: 0 }}>Nenhuma etapa de workflow definida para esta OS.</p>
                                    </div>
                                )}
                                {combinedMicroTasks.map((mt, idx) => (
                                    <div key={mt.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', backgroundColor: '#fff', border: '1px solid var(--color-border)', borderRadius: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.02)', gap: '16px', flexWrap: 'wrap' }}>
                                        <div style={{ flex: '1', display: 'grid', gridTemplateColumns: mt.isNew ? '1fr 1fr' : '1fr 1fr', gap: '16px', alignItems: 'center', minWidth: '300px' }}>
                                            {mt.isNew ? (
                                                <>
                                                    <input
                                                        placeholder="Nome da Função (ex: Edição)"
                                                        className="input"
                                                        value={mt.funcao}
                                                        onChange={e => updateNewMicroTask(mt.id, 'funcao', e.target.value)}
                                                        style={{ padding: '10px 14px', fontSize: '14px', fontWeight: '600', backgroundColor: 'var(--color-bg-subtle)' }}
                                                    />
                                                    <select
                                                        className="input"
                                                        value={mt.profissional_id}
                                                        onChange={e => updateNewMicroTask(mt.id, 'profissional_id', e.target.value)}
                                                        style={{ padding: '10px 14px', fontSize: '14px', fontWeight: '600', backgroundColor: 'var(--color-bg-subtle)' }}
                                                    >
                                                        <option value="">Atribuir Profissional...</option>
                                                        {professionals.map(p => (
                                                            <option key={p.id} value={p.id}>{p.nome}</option>
                                                        ))}
                                                    </select>
                                                </>
                                            ) : (
                                                <>
                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                        <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>Função da Etapa</span>
                                                        <span style={{ fontSize: '15px', fontWeight: '800', color: 'var(--color-text-primary)' }}>{mt.funcao}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                        <span style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>Responsável Atual</span>
                                                        <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--color-text-secondary)' }}>{mt.profissionais?.nome || '— Não Atribuído —'}</span>
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', paddingLeft: '20px', borderLeft: mt.isNew ? 'none' : '1px solid var(--color-border-light)' }}>
                                            {!mt.isNew && (
                                                <span className={`badge ${mt.status === 'concluida' ? 'badge-success' : mt.status === 'em_execucao' ? 'badge-primary' : 'badge-neutral'}`} style={{ padding: '6px 12px', fontSize: '12px' }}>
                                                    {mt.status.replace('_', ' ')}
                                                </span>
                                            )}

                                            <button
                                                type="button"
                                                onClick={() => handleRemoveMicroTask(mt.id, mt.isNew)}
                                                style={{ padding: '8px', borderRadius: '8px', border: 'none', background: 'var(--color-danger-bg)', color: 'var(--color-danger)', cursor: (!mt.isNew && (mt.status === 'em_execucao' || mt.status === 'concluida')) ? 'not-allowed' : 'pointer', opacity: (!mt.isNew && (mt.status === 'em_execucao' || mt.status === 'concluida')) ? 0.4 : 1, transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                title={(!mt.isNew && (mt.status === 'em_execucao' || mt.status === 'concluida')) ? 'Protegida: Etapa em andamento' : 'Excluir Etapa'}
                                                disabled={!mt.isNew && (mt.status === 'em_execucao' || mt.status === 'concluida')}
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Danger Zone */}
                    <div style={{ marginTop: '16px' }}>
                        <div style={{ padding: '24px', backgroundColor: 'var(--color-danger-bg)', border: '2px solid rgba(239, 68, 68, 0.2)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
                            <div style={{ flex: '1', minWidth: '240px' }}>
                                <h4 style={{ fontSize: '15px', fontWeight: '900', color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 6px 0', textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
                                    <AlertTriangle size={18} strokeWidth={3} /> ZONA DE REVOGAÇÃO
                                </h4>
                                <p style={{ fontSize: '13px', fontWeight: '600', color: 'rgba(239, 68, 68, 0.8)', margin: 0, lineHeight: '1.4' }}>O arquivamento desta OS é irreversível pela interface e bloqueará edições de equipe.</p>
                            </div>
                            <button
                                type="button"
                                onClick={handleCancelOS}
                                className="btn"
                                style={{ backgroundColor: '#fff', color: 'var(--color-danger)', border: '2px solid rgba(239, 68, 68, 0.3)', fontWeight: '800', boxShadow: '0 2px 4px rgba(239, 68, 68, 0.1)', cursor: !canEdit ? 'not-allowed' : 'pointer', opacity: !canEdit ? 0.5 : 1 }}
                                disabled={!canEdit}
                            >
                                Arquivar Definitivamente
                            </button>
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="modal-footer" style={{ padding: '20px 32px', borderTop: '1px solid rgba(0,0,0,0.06)', backgroundColor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: '1' }}>
                        {!checkingPermissions && !canEdit && (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-danger)', backgroundColor: 'var(--color-danger-bg)', padding: '6px 12px', borderRadius: '8px' }}>
                                <AlertTriangle size={14} strokeWidth={2.5} /> Permissão Somente Leitura
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn btn-secondary"
                            style={{ fontWeight: '700', padding: '12px 24px', borderRadius: '12px', border: '2px solid var(--color-border)' }}
                            disabled={loading}
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSave}
                            className="btn btn-primary"
                            style={{ fontWeight: '700', padding: '12px 24px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '8px', background: loading || !canEdit ? 'var(--color-border)' : 'var(--color-primary)' }}
                            disabled={loading || !canEdit}
                        >
                            {loading ? (
                                <>
                                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span>Salvando...</span>
                                    <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
                                </>
                            ) : (
                                'Salvar Alterações'
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    )
}

