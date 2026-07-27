import { useState, useEffect } from 'react'
import { CheckCircle, AlertTriangle, Layers, Building2, Calendar as CalendarIcon, Plus, X, GripVertical, Link, Upload, User } from 'lucide-react'
import { toast } from 'sonner'
import { clientService } from '../../services/clientService'
import { professionalsService } from '../../services/professionals'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { fileService } from '../../services/fileService'
import FileUpload from './FileUpload'
import '../../styles/admin-forms.css'

export default function TaskForm({ onSuccess, onCancel }) {
    const { user } = useAuth()

    // Data
    const [companies, setCompanies] = useState([])
    const [professionals, setProfessionals] = useState([])

    // Form
    const [clienteId, setClienteId] = useState('')
    const [titulo, setTitulo] = useState('')
    const [descricao, setDescricao] = useState('')
    const [deadline, setDeadline] = useState('')
    const [prioridade, setPrioridade] = useState('normal')
    const [driveLink, setDriveLink] = useState('')
    const [attachments, setAttachments] = useState([]) // New: Files state
    const [selectedFunctions, setSelectedFunctions] = useState([])

    // Workflow Mode
    const [useWorkflow, setUseWorkflow] = useState(false)
    const [workflowStages, setWorkflowStages] = useState([])

    // States
    const [loadingCompanies, setLoadingCompanies] = useState(true)
    const [loadingProfessionals, setLoadingProfessionals] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [uploadingFiles, setUploadingFiles] = useState(false) // New: Upload state

    useEffect(() => {
        loadCompanies()
        if (user?.id) {
            loadTenantData()
        }
    }, [user])

    // Load professionals when the user selects a company
    useEffect(() => {
        if (clienteId) {
            loadProfessionals(clienteId)
            // Reset dependencies
            setSelectedFunctions([])
            setWorkflowStages([])
        } else {
            setProfessionals([])
        }
    }, [clienteId])

    async function loadTenantData() {
        try {
            const { data: tenantData, error } = await supabase
                .from('empresa_profissionais')
                .select('empresa_id')
                .eq('profissional_id', user.id)
                .eq('ativo', true)
                .limit(1)
                .single()
            
            if (error && error.code !== 'PGRST116') throw error;
            
            if (tenantData?.empresa_id) {
                // Tenant identity resolved.
                // We don't auto-load professionals here anymore.
                // It happens when the user selects a company from the dropdown.
            }
        } catch (error) {
            console.error('Error loading tenant data:', error);
            // Optionally notify, but let's not block the UI
        }
    }

    async function loadCompanies() {
        try {
            setLoadingCompanies(true)
            const data = await clientService.getAll()
            setCompanies(data || [])

            // UX Guard: If no companies available (e.g., super admin), show appropriate state
            if (!data || data.length === 0) {
                console.warn('No operational companies available for this user')
            }
        } catch (error) {
            console.error(error)
            toast.error('Erro ao carregar empresas')
        } finally {
            setLoadingCompanies(false)
        }
    }

    const toggleFunction = (fn) => {
        if (selectedFunctions.includes(fn)) {
            setSelectedFunctions(prev => prev.filter(f => f !== fn))
        } else {
            setSelectedFunctions(prev => [...prev, fn])
        }
    }

    async function loadProfessionals(companyId) {
        try {
            setLoadingProfessionals(true)

            // Direct query to empresa_profissionais. `cargo` was dropped from
            // this table's real schema (added by the 2026-03-18 role/cargo
            // migration series, never applied here) — every other query in
            // this codebase already reads `funcao` only. The `p.cargo ||
            // p.funcao || 'Sem Cargo'` fallbacks below keep working exactly
            // as before, just always resolving through `funcao`.
            const { data, error } = await supabase
                .from('empresa_profissionais')
                .select(`
                    profissional_id,
                    funcao,
                    profissionais!inner (
                        id,
                        nome
                    )
                `)
                .eq('empresa_id', companyId)
                .eq('ativo', true)

            if (error) throw error

            setProfessionals(data || [])
        } catch (error) {
            console.error(error)
            toast.error('Erro ao carregar profissionais')
        } finally {
            setLoadingProfessionals(false)
        }
    }

    function addWorkflowStage() {
        setWorkflowStages([...workflowStages, {
            funcao: '',
            profissional_id: '',
            tags: [],
            prioridade: 'normal',
            depends_on_ordem: workflowStages.length > 0 ? workflowStages.length : null,
            deadline_at: ''
        }])
    }

    function addWorkflowStageFromFunction(funcao) {
        // Find professional for this function
        const professionalsForFunction = professionals.filter(p => (p.cargo || p.funcao || 'Sem Cargo') === funcao)
        const profissionalId = professionalsForFunction.length > 0 ? professionalsForFunction[0].profissional_id : ''

        setWorkflowStages([...workflowStages, {
            funcao: funcao,
            profissional_id: profissionalId,
            tags: [],
            prioridade: 'normal',
            depends_on_ordem: workflowStages.length > 0 ? workflowStages.length : null,
            deadline_at: ''
        }])
    }

    function removeWorkflowStage(index) {
        const newStages = workflowStages.filter((_, i) => i !== index)
        // Update dependencies
        setWorkflowStages(newStages.map((stage, i) => ({
            ...stage,
            depends_on_ordem: i > 0 ? i : null
        })))
    }

    function updateWorkflowStage(index, field, value) {
        const newStages = [...workflowStages]
        newStages[index] = { ...newStages[index], [field]: value }

        // Auto-fill professional when function is selected
        if (field === 'funcao' && value) {
            const professionalsForFunction = professionals.filter(p => (p.cargo || p.funcao || 'Sem Cargo') === value)
            if (professionalsForFunction.length > 0) {
                // Auto-select first professional of this function
                newStages[index].profissional_id = professionalsForFunction[0].profissional_id
            } else {
                // Clear professional if no one found
                newStages[index].profissional_id = ''
            }
        }

        setWorkflowStages(newStages)
    }

    const handleSubmit = async (e) => {
        e.preventDefault()

        // Basic validation
        if (!titulo || !titulo.trim()) {
            toast.error('Preencha o título da OS')
            return
        }

        if (!deadline) {
            toast.error('Selecione o prazo')
            return
        }

        // Validation
        if (useWorkflow) {
            if (workflowStages.length === 0) {
                toast.error('Adicione pelo menos uma etapa ao workflow')
                return
            }
            // Validate all stages have required fields
            for (let i = 0; i < workflowStages.length; i++) {
                const stage = workflowStages[i]
                if (!stage.funcao || !stage.profissional_id) {
                    toast.error(`Etapa ${i + 1}: Preencha função e profissional`)
                    return
                }
            }
        } else {
            if (selectedFunctions.length === 0) {
                toast.error('Selecione pelo menos uma função')
                return
            }
        }

        setSubmitting(true)
        try {
            const payload = {
                empresa_id: clienteId, // Backend uses this to valiadate and fetch permissions
                cliente_id: clienteId,
                titulo: titulo,
                descricao: descricao || null,
                deadline_at: new Date(deadline).toISOString(),
                prioridade: prioridade,
                drive_link: driveLink || null,
                created_by: user.id
            }

            // Add workflow stages or legacy functions
            if (useWorkflow) {
                payload.workflow_stages = workflowStages
            } else {
                payload.profissionais_ids = selectedFunctions // Using the same state but it now holds IDs
            }

            // Call Edge Function for centralized, atomic task creation
            const { data, error } = await supabase.functions.invoke('create-os-by-function', {
                body: payload
            })

            if (error) {
                console.error('Edge Function error:', error)
                const errorMessage = error.message || error.msg || 'Erro ao criar OS'
                toast.error(`Erro: ${errorMessage}`)
                throw new Error(errorMessage)
            }

            if (!data) {
                console.error('No data returned from Edge Function')
                toast.error('Erro: Nenhuma resposta da função')
                throw new Error('Nenhuma resposta da função')
            }

            if (!data.success) {
                console.error('Edge Function returned error:', data)
                const errorMessage = data.error || 'Falha ao criar OS'
                toast.error(`Erro: ${errorMessage}`)
                throw new Error(errorMessage)
            }

            // --- FILE UPLOAD LOGIC ---
            if (attachments.length > 0) {
                setUploadingFiles(true)
                let targetTaskId = null

                if (data.mode === 'macro_micro' && data.macro_task_id) {
                    targetTaskId = data.macro_task_id
                } else if (data.mode === 'legacy' && data.tasks && data.tasks.length > 0) {
                    // In legacy mode (multiple tasks), attach to the first one as primary
                    targetTaskId = data.tasks[0].id
                }

                if (targetTaskId) {
                    toast.loading('Enviando arquivos...', { id: 'upload-toast' })

                    const uploadResults = await fileService.uploadTaskAttachments(
                        attachments,
                        targetTaskId,
                        clienteId,
                        user.id
                    )

                    toast.dismiss('upload-toast')

                    if (uploadResults.failed.length > 0) {
                        toast.warning(`${uploadResults.success.length} arquivos enviados. ${uploadResults.failed.length} falharam.`)
                    } else {
                        toast.success(`${uploadResults.success.length} arquivos anexados com sucesso!`)
                    }
                } else {
                    console.warn('Could not determine target task ID for attachments')
                    toast.warning('OS criada, mas não foi possível anexar os arquivos (ID não encontrado)')
                }
            }

            // --- FEEDBACK VISUAL FINAL ---
            if (data.skipped && data.skipped.length > 0) {
                // Recupera o nome dos profissionais ignorados para o feedback ficar legível
                const skippedNames = data.skipped.map(s => {
                    const prof = professionals.find(p => p.profissional_id === s.profissional_id)
                    return prof?.profissionais?.nome || 'Profissional Desconhecido'
                }).join(', ')

                const createdCount = useWorkflow ? data.micro_tasks_created : data.tasks_created
                toast.warning(`OS criada! ${createdCount} atribuídas, mas ${data.skipped.length} não atribuída(s). Profissionais sem cargo válido: ${skippedNames}`, {
                    duration: 8000
                })
            } else {
                const successMessage = useWorkflow
                    ? `Macro tarefa criada! (${data.micro_tasks_created} etapas geradas)`
                    : `OS criada! (${data.tasks_created} tarefas geradas)`

                toast.success(successMessage)
            }

            if (onSuccess) {
                onSuccess(data)
            }

        } catch (error) {
            console.error('Error creating OS:', error)
            toast.error(error.message || 'Falha ao criar OS')
        } finally {
            setSubmitting(false)
            setUploadingFiles(false)
        }
    }

    const premiumInputStyle = {
        padding: '12px 14px', 
        borderRadius: '10px', 
        border: '1px solid var(--color-border)', 
        backgroundColor: 'var(--color-surface)',
        color: 'var(--color-text-primary)',
        fontSize: '0.95rem',
        width: '100%',
        outline: 'none',
        boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
        transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
    }

    return (
        <form onSubmit={handleSubmit} className="admin-form" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Company Selection */}
            <div className="admin-form-group">
                <label className="admin-form-label">
                    <Building2 className="admin-form-label-icon" />
                    Empresa *
                </label>
                <select
                    className="admin-form-select"
                    value={clienteId}
                    onChange={e => setClienteId(e.target.value)}
                    disabled={loadingCompanies || companies.length === 0}
                    style={premiumInputStyle}
                    required
                >
                    <option value="">
                        {loadingCompanies
                            ? 'Carregando...'
                            : companies.length === 0
                                ? 'Nenhuma empresa operacional disponível'
                                : 'Selecione...'}
                    </option>
                    {companies.map(c => (
                        <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                </select>
                {!loadingCompanies && companies.length === 0 && (
                    <p className="admin-mode-description" style={{ color: 'var(--color-warning)', marginTop: '8px' }}>
                        Super admins não criam tarefas para empresas operacionais.
                    </p>
                )}
            </div>

            {/* Title */}
            <div className="admin-form-group">
                <label className="admin-form-label">
                    Título da OS *
                </label>
                <input
                    type="text"
                    className="admin-form-input"
                    value={titulo}
                    onChange={e => setTitulo(e.target.value)}
                    placeholder="Ex: Campanha Black Friday"
                    style={premiumInputStyle}
                    required
                />
            </div>

            {/* Description */}
            <div className="admin-form-group">
                <label className="admin-form-label">
                    Descrição
                </label>
                <textarea
                    className="admin-form-textarea"
                    value={descricao}
                    onChange={e => setDescricao(e.target.value)}
                    rows={4}
                    placeholder="Detalhes da demanda..."
                    style={{ ...premiumInputStyle, minHeight: '120px', resize: 'vertical' }}
                />
            </div>

            {/* Deadline */}
            <div className="admin-form-group">
                <label className="admin-form-label">
                    <CalendarIcon className="admin-form-label-icon" />
                    Prazo *
                </label>
                <input
                    type="datetime-local"
                    className="admin-form-input"
                    value={deadline}
                    onChange={e => setDeadline(e.target.value)}
                    max="2099-12-31T23:59"
                    style={premiumInputStyle}
                    required
                />
            </div>

            {/* Priority */}
            <div className="admin-form-group">
                <label className="admin-form-label">
                    Prioridade *
                </label>
                <select
                    className="admin-form-select"
                    value={prioridade}
                    onChange={e => setPrioridade(e.target.value)}
                    style={premiumInputStyle}
                >
                    <option value="baixa">Baixa</option>
                    <option value="normal">Normal</option>
                    <option value="alta">Alta</option>
                    <option value="urgente">Urgente</option>
                </select>
            </div>

            {/* Drive Link */}
            <div className="admin-form-group">
                <label className="admin-form-label">
                    <Link className="admin-form-label-icon" />
                    Link do Drive
                </label>
                <input
                    type="url"
                    className="admin-form-input"
                    value={driveLink}
                    onChange={e => setDriveLink(e.target.value)}
                    placeholder="https://drive.google.com/..."
                    style={premiumInputStyle}
                />
            </div>

            {/* File Attachments */}
            <div className="admin-form-group">
                <label className="admin-form-label">
                    <Upload className="admin-form-label-icon" />
                    Anexar Arquivos
                </label>
                <FileUpload
                    files={attachments}
                    onFilesChange={setAttachments}
                />
                <p className="admin-form-helper" style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                    Máx 5 arquivos de até 10MB cada.
                </p>
            </div>

            {/* Workflow Mode Toggle */}
            <div className="admin-form-group">
                    <label className="admin-form-label">
                        Modo de Criação
                    </label>
                    <div className="admin-mode-toggle" style={{ 
                        display: 'flex', 
                        gap: '4px', 
                        padding: '4px', 
                        backgroundColor: 'var(--color-surface)', 
                        borderRadius: '12px', 
                        border: '1px solid var(--color-border)',
                        width: '100%'
                    }}>
                        <button
                            type="button"
                            onClick={() => {
                                setUseWorkflow(false)
                                setWorkflowStages([])
                            }}
                            style={{ 
                                flex: 1,
                                justifyContent: 'center',
                                padding: '12px 24px', 
                                borderRadius: '8px', 
                                border: 'none', 
                                backgroundColor: !useWorkflow ? 'var(--color-primary)' : 'transparent',
                                color: !useWorkflow ? '#ffffff' : 'var(--color-text-secondary)',
                                fontWeight: !useWorkflow ? 600 : 500,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'all 0.2s ease',
                                cursor: 'pointer',
                                boxShadow: !useWorkflow ? '0 2px 8px rgba(var(--color-primary-rgb), 0.3)' : 'none'
                            }}
                        >
                            {!useWorkflow && <CheckCircle size={16} strokeWidth={2.5} />}
                            OS Simples
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setUseWorkflow(true)
                                setSelectedFunctions([])
                            }}
                            style={{ 
                                flex: 1,
                                justifyContent: 'center',
                                padding: '12px 24px', 
                                borderRadius: '8px', 
                                border: 'none', 
                                backgroundColor: useWorkflow ? 'var(--color-primary)' : 'transparent',
                                color: useWorkflow ? '#ffffff' : 'var(--color-text-secondary)',
                                fontWeight: useWorkflow ? 600 : 500,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                transition: 'all 0.2s ease',
                                cursor: 'pointer',
                                boxShadow: useWorkflow ? '0 2px 8px rgba(var(--color-primary-rgb), 0.3)' : 'none'
                            }}
                        >
                            {useWorkflow && <CheckCircle size={16} strokeWidth={2.5} />}
                            OS Múltipla
                        </button>
                    </div>
                    <p className="admin-mode-description">
                        {useWorkflow
                            ? 'Crie uma OS centralizada contendo etapas (Micro) distribuídas para profissionais.'
                            : 'Crie OSs individuais para cada cargo selecionado.'}
                    </p>
                </div>

            {/* Workflow Builder */}
            {useWorkflow && (
                <>
                    {/* Function Selection for Workflow */}
                    <div className="admin-form-group">
                        <label className="admin-form-label">
                            <Layers className="admin-form-label-icon" />
                            Funções *
                        </label>
                        {loadingProfessionals ? (
                            <p className="text-secondary text-sm">Carregando...</p>
                        ) : professionals.length === 0 ? (
                            <div className="admin-form-empty-state">
                                <AlertTriangle size={16} />
                                <span>Nenhuma função disponível para esta empresa</span>
                            </div>
                        ) : (
                            <div className="admin-functions-grid" style={{ 
                                display: 'grid', 
                                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
                                gap: '12px' 
                            }}>
                                {Object.keys(
                                    professionals.reduce((acc, p) => { 
                                        const displayKey = p.cargo || p.funcao || 'Sem Cargo'
                                        acc[displayKey] = true
                                        return acc 
                                    }, {})
                                ).sort((a, b) => a.localeCompare(b)).map(fn => (
                                    <button
                                        key={fn}
                                        type="button"
                                        onClick={() => addWorkflowStageFromFunction(fn)}
                                        className="admin-function-btn"
                                        style={{ 
                                            flexDirection: 'row', 
                                            alignItems: 'center', 
                                            justifyContent: 'flex-start', 
                                            gap: '12px', 
                                            padding: '12px 14px',
                                            height: 'auto',
                                            textAlign: 'left',
                                            borderRadius: '8px',
                                            border: '1px solid var(--color-border)',
                                            backgroundColor: 'var(--color-surface)'
                                        }}
                                    >
                                        <div style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            justifyContent: 'center', 
                                            minWidth: '28px', 
                                            height: '28px', 
                                            borderRadius: '50%', 
                                            backgroundColor: 'rgba(0,0,0,0.04)', 
                                            color: 'var(--color-text-tertiary)' 
                                        }}>
                                            <Plus size={14} />
                                        </div>
                                        <strong style={{ 
                                            fontSize: '0.9rem', 
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            color: 'var(--color-text-primary)'
                                        }}>
                                            {fn}
                                        </strong>
                                    </button>
                                ))}
                            </div>
                        )}
                        <p className="admin-mode-description">
                            Clique nas funções para adicionar etapas ao workflow
                        </p>
                    </div>

                    {/* Workflow Stages List */}
                    <div className="admin-form-group">
                        <label className="admin-form-label">
                            Etapas do Workflow ({workflowStages.length})
                        </label>

                        {workflowStages.length === 0 ? (
                            <div className="admin-form-empty-state">
                                <AlertTriangle size={16} />
                                <span>Clique nas funções acima para adicionar etapas</span>
                            </div>
                        ) : (
                            <div className="admin-workflow-list" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {workflowStages.map((stage, index) => (
                                    <div key={index} className="admin-workflow-stage-card" style={{
                                        backgroundColor: 'var(--color-surface)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: '12px',
                                        padding: '20px',
                                        boxShadow: '0 4px 16px rgba(0,0,0,0.03)'
                                    }}>
                                        <div className="admin-workflow-stage-header" style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            borderBottom: '1px solid var(--color-divider)',
                                            paddingBottom: '16px',
                                            marginBottom: '20px'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', flex: 1, gap: '10px' }}>
                                                <GripVertical size={16} className="text-tertiary" style={{ cursor: 'grab', color: 'var(--color-text-tertiary)' }} />
                                                <span className="admin-workflow-stage-title" style={{
                                                    fontSize: '1.05rem',
                                                    fontWeight: 600,
                                                    letterSpacing: '0.3px',
                                                    color: 'var(--color-text-primary)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}>
                                                    <span style={{ 
                                                        backgroundColor: 'var(--color-background)', 
                                                        color: 'var(--color-text-secondary)',
                                                        fontSize: '0.75rem', 
                                                        padding: '4px 8px', 
                                                        borderRadius: '6px',
                                                        border: '1px solid var(--color-border)'
                                                    }}>
                                                        ETAPA {index + 1}
                                                    </span>
                                                    {stage.funcao}
                                                </span>
                                                {index > 0 && (
                                                    <span className="admin-workflow-stage-subtitle" style={{
                                                        fontSize: '0.8rem',
                                                        color: 'var(--color-text-tertiary)',
                                                        marginLeft: '8px'
                                                    }}>
                                                        (depende da Etapa {index})
                                                    </span>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => removeWorkflowStage(index)}
                                                className="admin-workflow-remove-btn"
                                                title="Remover etapa"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    width: '32px',
                                                    height: '32px',
                                                    borderRadius: '8px',
                                                    border: 'none',
                                                    backgroundColor: 'var(--color-danger-light)',
                                                    color: 'var(--color-danger)',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                <X size={16} strokeWidth={2.5} />
                                            </button>
                                        </div>

                                        <div className="admin-workflow-content" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                            {/* Professional and Priority Row */}
                                            <div className="admin-workflow-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: '16px' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                    <label className="admin-workflow-label" style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                                                        Profissional *
                                                    </label>
                                                    <select
                                                        className="admin-form-select"
                                                        value={stage.profissional_id}
                                                        onChange={(e) => updateWorkflowStage(index, 'profissional_id', e.target.value)}
                                                        style={{ 
                                                            padding: '10px 14px', 
                                                            borderRadius: '8px', 
                                                            border: '1px solid var(--color-border)', 
                                                            backgroundColor: 'var(--color-surface)',
                                                            color: 'var(--color-text-primary)',
                                                            fontSize: '0.9rem',
                                                            width: '100%',
                                                            cursor: 'pointer',
                                                            outline: 'none',
                                                            boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
                                                        }}
                                                        required
                                                    >
                                                        <option value="">
                                                            {professionals.filter(p => (p.cargo || p.funcao || 'Sem Cargo') === stage.funcao).length === 0
                                                                ? 'Nenhum profissional encontrado'
                                                                : 'Selecione...'}
                                                        </option>
                                                        {professionals
                                                            .filter(p => (p.cargo || p.funcao || 'Sem Cargo') === stage.funcao)
                                                            .map(p => (
                                                                <option key={p.profissional_id} value={p.profissional_id}>
                                                                    {p.profissionais.nome}
                                                                </option>
                                                            ))}
                                                    </select>
                                                    {professionals.filter(p => (p.cargo || p.funcao || 'Sem Cargo') === stage.funcao).length === 0 && (
                                                        <span className="admin-workflow-warning">
                                                            <AlertTriangle size={12} />
                                                            Adicione um profissional desta função
                                                        </span>
                                                    )}
                                                </div>

                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                    <label className="admin-workflow-label" style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                                                        Prioridade
                                                    </label>
                                                    <select
                                                        className="admin-form-select"
                                                        value={stage.prioridade || 'normal'}
                                                        onChange={(e) => updateWorkflowStage(index, 'prioridade', e.target.value)}
                                                        style={{ 
                                                            padding: '10px 14px', 
                                                            borderRadius: '8px', 
                                                            border: '1px solid var(--color-border)', 
                                                            backgroundColor: 'var(--color-surface)',
                                                            color: 'var(--color-text-primary)',
                                                            fontSize: '0.9rem',
                                                            width: '100%',
                                                            cursor: 'pointer',
                                                            outline: 'none',
                                                            boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
                                                        }}
                                                    >
                                                        <option value="baixa">Baixa</option>
                                                        <option value="normal">Normal</option>
                                                        <option value="alta">Alta</option>
                                                        <option value="urgente">Urgente</option>
                                                    </select>
                                                </div>
                                            </div>

                                            {/* Tags Row */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <label className="admin-workflow-label" style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                                                    Tags (opcional)
                                                </label>
                                                <input
                                                    type="text"
                                                    className="admin-form-input"
                                                    placeholder="ex: urgente, revisão..."
                                                    value={stage.tags?.join(', ') || ''}
                                                    onChange={(e) => {
                                                        const tags = e.target.value.split(',').map(t => t.trim()).filter(t => t)
                                                        updateWorkflowStage(index, 'tags', tags)
                                                    }}
                                                    style={{ 
                                                        padding: '10px 14px', 
                                                        borderRadius: '8px', 
                                                        border: '1px solid var(--color-border)', 
                                                    }}
                                                />
                                            </div>

                                            {/* Deadline Row */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <label className="admin-workflow-label" style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                                                    <CalendarIcon size={14} style={{ marginRight: '6px', display: 'inline', position: 'relative', top: '2px', color: 'var(--color-text-tertiary)' }} />
                                                    Prazo da Etapa (opcional)
                                                </label>
                                                <input
                                                    type="datetime-local"
                                                    className="admin-form-input"
                                                    value={stage.deadline_at || ''}
                                                    onChange={(e) => updateWorkflowStage(index, 'deadline_at', e.target.value)}
                                                    max="2099-12-31T23:59"
                                                />
                                                <p className="admin-form-helper" style={{
                                                    fontSize: '0.7rem',
                                                    color: 'var(--color-text-tertiary)',
                                                    marginTop: '2px'
                                                }}>
                                                    Deixe em branco se não houver SLA para esta etapa
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Functions — derived from professionals (single source of truth) */}
            {!useWorkflow && (() => {
                const sortedProfessionals = [...professionals].sort((a, b) => {
                    const nameA = a.profissionais?.nome?.toLowerCase() || ''
                    const nameB = b.profissionais?.nome?.toLowerCase() || ''
                    return nameA.localeCompare(nameB)
                })

                return (
                    <div className="admin-form-group">
                        <label className="admin-form-label">
                            <Layers className="admin-form-label-icon" />
                            Profissionais *
                        </label>
                        {loadingProfessionals ? (
                            <p className="text-secondary text-sm">Carregando...</p>
                        ) : sortedProfessionals.length === 0 ? (
                            <div className="admin-form-empty-state">
                                <AlertTriangle size={16} />
                                <span>Nenhum profissional disponível para esta empresa</span>
                            </div>
                        ) : (
                            <div className="admin-functions-grid" style={{ 
                                display: 'grid', 
                                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', 
                                gap: '12px' 
                            }}>
                                {sortedProfessionals.map(p => {
                                    const cargoName = p.cargo || p.funcao || 'Sem Cargo'
                                    const isSelected = selectedFunctions.includes(p.profissional_id)
                                    return (
                                        <button
                                            key={p.profissional_id}
                                            type="button"
                                            onClick={() => toggleFunction(p.profissional_id)}
                                            className={`admin-function-btn ${isSelected ? 'selected' : ''}`}
                                            style={{ 
                                                flexDirection: 'row', 
                                                alignItems: 'center', 
                                                justifyContent: 'flex-start', 
                                                gap: '12px', 
                                                padding: '12px 14px',
                                                height: 'auto',
                                                textAlign: 'left'
                                            }}
                                        >
                                            <div style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                justifyContent: 'center', 
                                                minWidth: '28px', 
                                                height: '28px', 
                                                borderRadius: '50%', 
                                                backgroundColor: isSelected ? 'rgba(var(--color-primary-rgb), 0.1)' : 'rgba(0,0,0,0.04)', 
                                                color: isSelected ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                                                transition: 'all 0.2s ease'
                                            }}>
                                                {isSelected ? <CheckCircle size={14} strokeWidth={2.5} /> : <User size={14} />}
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                                <strong style={{ 
                                                    fontSize: '0.9rem', 
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    color: isSelected ? 'var(--color-primary-dark)' : 'var(--color-text-primary)'
                                                }}>
                                                    {p.profissionais?.nome}
                                                </strong>
                                                <span style={{
                                                    fontSize: '0.7rem',
                                                    color: isSelected ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                                                    marginTop: '2px',
                                                    fontWeight: 600,
                                                    letterSpacing: '0.3px',
                                                    textTransform: 'uppercase'
                                                }}>
                                                    {cargoName}
                                                </span>
                                            </div>
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                        <p className="admin-mode-description" style={{ marginTop: '16px' }}>
                            Selecione os profissionais individualmente. Uma OS será criada para cada pessoa selecionada.
                        </p>
                    </div>
                )
            })()}

            {/* Actions */}
            <div className="admin-form-actions" style={{ 
                display: 'flex', 
                justifyContent: 'flex-end', 
                gap: '16px', 
                marginTop: '12px', 
                paddingTop: '24px', 
                borderTop: '1px solid var(--color-border)' 
            }}>
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="admin-form-btn-cancel"
                        disabled={submitting}
                        style={{ 
                            padding: '12px 24px', 
                            borderRadius: '10px', 
                            border: '1px solid var(--color-border)', 
                            backgroundColor: 'transparent', 
                            color: 'var(--color-text-secondary)', 
                            fontWeight: 600, 
                            cursor: 'pointer', 
                            transition: 'all 0.2s ease' 
                        }}
                    >
                        Cancelar
                    </button>
                )}
                <button
                    type="submit"
                    className="admin-form-btn-submit"
                    disabled={submitting || (useWorkflow ? workflowStages.length === 0 : selectedFunctions.length === 0)}
                    style={{ 
                        padding: '12px 32px', 
                        borderRadius: '10px', 
                        border: 'none', 
                        backgroundColor: (submitting || (useWorkflow ? workflowStages.length === 0 : selectedFunctions.length === 0)) ? 'var(--color-text-tertiary)' : 'var(--color-primary)', 
                        color: '#ffffff', 
                        fontWeight: 600, 
                        cursor: (submitting || (useWorkflow ? workflowStages.length === 0 : selectedFunctions.length === 0)) ? 'not-allowed' : 'pointer', 
                        boxShadow: (submitting || (useWorkflow ? workflowStages.length === 0 : selectedFunctions.length === 0)) ? 'none' : '0 4px 14px rgba(var(--color-primary-rgb), 0.35)', 
                        transition: 'all 0.2s ease' 
                    }}
                >
                    {submitting
                        ? (uploadingFiles ? 'Enviando arquivos...' : 'Criando...')
                        : (useWorkflow ? 'Criar Macro Tarefa' : 'Criar OS')}
                </button>
            </div>
        </form>
    )
}
