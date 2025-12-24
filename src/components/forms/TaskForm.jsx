import { useState, useEffect } from 'react'
import { CheckCircle, AlertTriangle, Layers, Building2, Calendar as CalendarIcon } from 'lucide-react'
import { toast } from 'sonner'
import { clientService } from '../../services/clientService'
import { professionalsService } from '../../services/professionals'
import { supabase } from '../../services/supabase'

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

            toast.success(\`OS criada com sucesso! (\${data.tasks_created} tarefas geradas)\`)
            
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
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* Company Selection */}
            <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                    <Building2 className="inline w-4 h-4 mr-1.5 text-slate-500" />
                    Empresa *
                </label>
                <select
                    className="input-premium"
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
            <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Título da OS *
                </label>
                <input
                    type="text"
                    className="input-premium"
                    value={titulo}
                    onChange={e => setTitulo(e.target.value)}
                    placeholder="Ex: Campanha Black Friday"
                    required
                />
            </div>

            {/* Description */}
            <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Descrição
                </label>
                <textarea
                    className="input-premium"
                    value={descricao}
                    onChange={e => setDescricao(e.target.value)}
                    rows={3}
                    placeholder="Detalhes da demanda..."
                />
            </div>

            {/* Deadline */}
            <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                    <CalendarIcon className="inline w-4 h-4 mr-1.5 text-slate-500" />
                    Prazo *
                </label>
                <input
                    type="datetime-local"
                    className="input-premium"
                    value={deadline}
                    onChange={e => setDeadline(e.target.value)}
                    required
                />
            </div>

            {/* Priority */}
            <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                    Prioridade *
                </label>
                <select
                    className="input-premium"
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
                <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                        <Layers className="inline w-4 h-4 mr-1.5 text-slate-500" />
                        Funções *
                    </label>
                    {loadingFunctions ? (
                        <p className="text-sm text-slate-500">Carregando...</p>
                    ) : availableFunctions.length === 0 ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                            <AlertTriangle className="inline w-4 h-4 mr-1.5 text-amber-600" />
                            <span className="text-sm text-amber-700">Nenhuma função disponível para esta empresa</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2">
                            {availableFunctions.map(fn => (
                                <button
                                    key={fn}
                                    type="button"
                                    onClick={() => toggleFunction(fn)}
                                    className={\`px-4 py-2 rounded-lg border text-sm font-medium transition-all \${
                                        selectedFunctions.includes(fn)
                                            ? 'bg-slate-900 text-white border-slate-900'
                                            : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                                    }\`}
                                >
                                    {selectedFunctions.includes(fn) && <CheckCircle className="inline w-4 h-4 mr-1" />}
                                    {fn}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-4">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="btn btn-ghost flex-1"
                        disabled={submitting}
                    >
                        Cancelar
                    </button>
                )}
                <button
                    type="submit"
                    className="btn btn-primary flex-1"
                    disabled={submitting || selectedFunctions.length === 0}
                >
                    {submitting ? 'Criando...' : 'Criar OS'}
                </button>
            </div>
        </form>
    )
}
