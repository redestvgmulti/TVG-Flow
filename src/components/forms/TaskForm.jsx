import { useState, useEffect } from 'react'
import { CheckCircle, AlertTriangle, Layers, Building2, Calendar as CalendarIcon } from 'lucide-react'
import { toast } from 'sonner'
import { clientService } from '../../services/clientService'
import { professionalsService } from '../../services/professionals'
import { supabase } from '../../services/supabase'
import '../../styles/admin-forms.css'

export default function TaskForm({ onSuccess, onCancel }) {
    // Data
    const [companies, setCompanies] = useState([])
    const [availableFunctions, setAvailableFunctions] = useState([])

    // Form
    const [empresaId, setEmpresaId] = useState('')
    const [titulo, setTitulo] = useState('')
    const [descricao, setDescricao] = useState('')
    const [deadline, setDeadline] = useState('')
    const [prioridade, setPrioridade] = useState('normal')
    const [selectedFunctions, setSelectedFunctions] = useState([])

    // States
    const [loadingCompanies, setLoadingCompanies] = useState(true)
    const [loadingFunctions, setLoadingFunctions] = useState(false)
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        loadCompanies()
    }, [])

    useEffect(() => {
        if (empresaId) {
            loadFunctions(empresaId)
        } else {
            setAvailableFunctions([])
            setSelectedFunctions([])
        }
    }, [empresaId])

    async function loadCompanies() {
        try {
            setLoadingCompanies(true)
            const data = await clientService.getAll()
            setCompanies(data || [])
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

    const handleSubmit = async (e) => {
        e.preventDefault()

        if (!empresaId || !titulo || selectedFunctions.length === 0 || !deadline) {
            toast.error('Preencha todos os campos obrigatórios')
            return
        }

        setSubmitting(true)
        try {
            // Call Edge Function for centralized, atomic task creation
            const { data, error } = await supabase.functions.invoke('create-os-by-function', {
                body: {
                    empresa_id: empresaId,
                    titulo: titulo,
                    descricao: descricao || null,
                    deadline_at: new Date(deadline).toISOString(),
                    funcoes: selectedFunctions,
                    prioridade: prioridade
                }
            })

            if (error) {
                console.error('Edge Function error:', error)
                throw new Error(error.message || 'Erro ao criar OS')
            }

            if (!data || !data.success) {
                throw new Error(data?.error || 'Falha ao criar OS')
            }

            toast.success(`OS criada com sucesso! (${data.tasks_created} tarefas geradas)`)

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
                    disabled={loadingCompanies}
                    required
                >
                    <option value="">Selecione...</option>
                    {companies.map(c => (
                        <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                </select>
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

            {/* Functions */}
            {empresaId && (
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
                    disabled={submitting || selectedFunctions.length === 0}
                >
                    {submitting ? 'Criando...' : 'Criar OS'}
                </button>
            </div>
        </form>
    )
}
