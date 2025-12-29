import { useState, useEffect } from 'react'
import { CheckCircle, AlertTriangle, Layers, Building2, Calendar as CalendarIcon, Plus, X, GripVertical, Folder } from 'lucide-react'
import { toast } from 'sonner'
import { clientService } from '../../services/clientService'
import { professionalsService } from '../../services/professionals'
import { supabase } from '../../services/supabase'
import '../../styles/admin-forms.css'

export default function TaskForm({ onSuccess, onCancel }) {
    // Data
    const [companies, setCompanies] = useState([])
    const [availableFunctions, setAvailableFunctions] = useState([])
    const [professionals, setProfessionals] = useState([])

    // Form
    const [empresaId, setEmpresaId] = useState('')
    const [titulo, setTitulo] = useState('')
    const [descricao, setDescricao] = useState('')
    const [deadline, setDeadline] = useState('')
    const [prioridade, setPrioridade] = useState('normal')
    const [driveLink, setDriveLink] = useState('')
    const [selectedFunctions, setSelectedFunctions] = useState([])

    // Workflow Mode
    const [useWorkflow, setUseWorkflow] = useState(false)
    const [workflowStages, setWorkflowStages] = useState([])

    // States
    const [loadingCompanies, setLoadingCompanies] = useState(true)
    const [loadingFunctions, setLoadingFunctions] = useState(false)
    const [loadingProfessionals, setLoadingProfessionals] = useState(false)
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        loadCompanies()
    }, [])

    useEffect(() => {
        if (empresaId) {
            loadFunctions(empresaId)
            if (useWorkflow) {
                loadProfessionals(empresaId)
            }
        } else {
            setAvailableFunctions([])
            setSelectedFunctions([])
            setProfessionals([])
            setWorkflowStages([])
        }
    }, [empresaId, useWorkflow])

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

    async function loadFunctions(companyId) {
        try {
            setLoadingFunctions(true)
            const funcs = await professionalsService.getFunctionsByCompany(companyId)
            setAvailableFunctions(funcs || [])
        } catch (error) {
            console.error(error)
            toast.error('Erro ao buscar funções da empresa')
        } finally {
            setLoadingFunctions(false)
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
            depends_on_ordem: workflowStages.length > 0 ? workflowStages.length : null
        }])
    }

    function addWorkflowStageFromFunction(funcao) {
        // Find professional for this function
        const professionalsForFunction = professionals.filter(p => p.funcao === funcao)
        const profissionalId = professionalsForFunction.length > 0 ? professionalsForFunction[0].profissional_id : ''

        setWorkflowStages([...workflowStages, {
            funcao: funcao,
            profissional_id: profissionalId,
            tags: [],
            prioridade: 'normal',
            depends_on_ordem: workflowStages.length > 0 ? workflowStages.length : null
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
            const professionalsForFunction = professionals.filter(p => p.funcao === value)
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
                empresa_id: empresaId,
                titulo: titulo,
                descricao: descricao || null,
                deadline_at: new Date(deadline).toISOString(),
                prioridade: prioridade,
                drive_link: driveLink || null
            }

            // Add workflow stages or legacy functions
            if (useWorkflow) {
                payload.workflow_stages = workflowStages
            } else {
                payload.funcoes = selectedFunctions
            }

            // Call Edge Function for centralized, atomic task creation
            const { data, error } = await supabase.functions.invoke('create-os-by-function', {
                body: payload
            })

            console.log('Edge Function Response:', { data, error, payload })

            if (error) {
                console.error('Edge Function error:', error)
                // Try to extract error message from response
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

            const successMessage = useWorkflow
                ? `Macro tarefa criada! (${data.micro_tasks_created} etapas geradas)`
                : `OS criada! (${data.tasks_created} tarefas geradas)`

            toast.success(successMessage)

            if (onSuccess) {
                onSuccess(data)
            }

        } catch (error) {
            console.error('Error creating OS:', error)
            toast.error(error.message || 'Falha ao criar OS')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <form onSubmit={handleSubmit} className="admin-form">
            {/* Company Selection */}
            <div className="admin-form-group">
                <label className="admin-form-label">
                    <Building2 className="admin-form-label-icon" />
                    Empresa *
                </label>
                <select
                    className="admin-form-select"
                    value={empresaId}
                    onChange={e => setEmpresaId(e.target.value)}
                    disabled={loadingCompanies || companies.length === 0}
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
                    rows={3}
                    placeholder="Detalhes da demanda..."
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
                    <Folder className="admin-form-label-icon" />
                    Link do Drive
                </label>
                <input
                    type="url"
                    className="admin-form-input"
                    value={driveLink}
                    onChange={e => setDriveLink(e.target.value)}
                    placeholder="https://drive.google.com/..."
                />
            </div>

            {/* Workflow Mode Toggle */}
            {empresaId && (
                <div className="admin-form-group">
                    <label className="admin-form-label">
                        Modo de Criação
                    </label>
                    <div className="admin-mode-toggle">
                        <button
                            type="button"
                            onClick={() => {
                                setUseWorkflow(false)
                                setWorkflowStages([])
                            }}
                            className={`admin-function-btn ${!useWorkflow ? 'selected' : ''}`}
                        >
                            {!useWorkflow && <CheckCircle size={14} />}
                            Modo Legado (Múltiplas Tarefas)
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setUseWorkflow(true)
                                setSelectedFunctions([])
                            }}
                            className={`admin-function-btn ${useWorkflow ? 'selected' : ''}`}
                        >
                            {useWorkflow && <CheckCircle size={14} />}
                            Workflow (Macro/Micro)
                        </button>
                    </div>
                    <p className="admin-mode-description">
                        {useWorkflow
                            ? 'Crie uma tarefa macro com etapas sequenciais atribuídas a profissionais específicos'
                            : 'Crie tarefas individuais para cada função selecionada (comportamento atual)'}
                    </p>
                </div>
            )}

            {/* Workflow Builder */}
            {empresaId && useWorkflow && (
                <>
                    {/* Function Selection for Workflow */}
                    <div className="admin-form-group">
                        <label className="admin-form-label">
                            <Layers className="admin-form-label-icon" />
                            Funções *
                        </label>
                        {loadingFunctions ? (
                            <p className="text-secondary text-sm">Carregando...</p>
                        ) : availableFunctions.length === 0 ? (
                            <div className="admin-form-empty-state">
                                <AlertTriangle size={16} />
                                <span>Nenhuma função disponível para esta empresa</span>
                            </div>
                        ) : (
                            <div className="admin-functions-grid">
                                {availableFunctions.map(fn => (
                                    <button
                                        key={fn}
                                        type="button"
                                        onClick={() => addWorkflowStageFromFunction(fn)}
                                        className="admin-function-btn"
                                    >
                                        <Plus size={14} />
                                        {fn}
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
                            <div className="admin-workflow-list">
                                {workflowStages.map((stage, index) => (
                                    <div key={index} className="admin-workflow-stage-card">
                                        <div className="admin-workflow-stage-header">
                                            <GripVertical size={16} className="text-tertiary" />
                                            <span className="admin-workflow-stage-title">Etapa {index + 1}: {stage.funcao}</span>
                                            {index > 0 && (
                                                <span className="admin-workflow-stage-subtitle">
                                                    (depende da Etapa {index})
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => removeWorkflowStage(index)}
                                                className="admin-workflow-remove-btn"
                                                title="Remover etapa"
                                            >
                                                <X size={18} />
                                            </button>
                                        </div>

                                        <div className="admin-workflow-content">
                                            {/* Professional and Priority Row */}
                                            <div className="admin-workflow-row">
                                                <div>
                                                    <label className="admin-workflow-label">
                                                        Profissional *
                                                    </label>
                                                    <select
                                                        className="admin-form-select"
                                                        value={stage.profissional_id}
                                                        onChange={(e) => updateWorkflowStage(index, 'profissional_id', e.target.value)}
                                                        required
                                                    >
                                                        <option value="">
                                                            {professionals.filter(p => p.funcao === stage.funcao).length === 0
                                                                ? 'Nenhum profissional encontrado'
                                                                : 'Selecione...'}
                                                        </option>
                                                        {professionals
                                                            .filter(p => p.funcao === stage.funcao)
                                                            .map(p => (
                                                                <option key={p.profissional_id} value={p.profissional_id}>
                                                                    {p.profissionais.nome}
                                                                </option>
                                                            ))}
                                                    </select>
                                                    {professionals.filter(p => p.funcao === stage.funcao).length === 0 && (
                                                        <span className="admin-workflow-warning">
                                                            <AlertTriangle size={12} />
                                                            Adicione um profissional desta função
                                                        </span>
                                                    )}
                                                </div>

                                                <div>
                                                    <label className="admin-workflow-label">
                                                        Prioridade
                                                    </label>
                                                    <select
                                                        className="admin-form-select"
                                                        value={stage.prioridade || 'normal'}
                                                        onChange={(e) => updateWorkflowStage(index, 'prioridade', e.target.value)}
                                                    >
                                                        <option value="baixa">Baixa</option>
                                                        <option value="normal">Normal</option>
                                                        <option value="alta">Alta</option>
                                                        <option value="urgente">Urgente</option>
                                                    </select>
                                                </div>
                                            </div>

                                            {/* Tags Row */}
                                            <div>
                                                <label className="admin-workflow-label">
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
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Functions */}
            {empresaId && !useWorkflow && (
                <div className="admin-form-group">
                    <label className="admin-form-label">
                        <Layers className="admin-form-label-icon" />
                        Funções *
                    </label>
                    {loadingFunctions ? (
                        <p className="text-secondary text-sm">Carregando...</p>
                    ) : availableFunctions.length === 0 ? (
                        <div className="admin-form-empty-state">
                            <AlertTriangle size={16} />
                            <span>Nenhuma função disponível para esta empresa</span>
                        </div>
                    ) : (
                        <div className="admin-functions-grid">
                            {availableFunctions.map(fn => (
                                <button
                                    key={fn}
                                    type="button"
                                    onClick={() => toggleFunction(fn)}
                                    className={`admin-function-btn ${selectedFunctions.includes(fn) ? 'selected' : ''}`}
                                >
                                    {selectedFunctions.includes(fn) && <CheckCircle size={14} />}
                                    {fn}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Actions */}
            <div className="admin-form-actions">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="admin-form-btn-cancel"
                        disabled={submitting}
                    >
                        Cancelar
                    </button>
                )}
                <button
                    type="submit"
                    className="admin-form-btn-submit"
                    disabled={submitting || (useWorkflow ? workflowStages.length === 0 : selectedFunctions.length === 0)}
                >
                    {submitting ? 'Criando...' : (useWorkflow ? 'Criar Macro Tarefa' : 'Criar OS')}
                </button>
            </div>
        </form>
    )
}
