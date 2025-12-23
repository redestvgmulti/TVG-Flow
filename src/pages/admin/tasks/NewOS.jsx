
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle, AlertTriangle, Layers, Building2, Calendar as CalendarIcon } from 'lucide-react'
import { toast } from 'sonner'
import { clientService } from '../../../services/clientService'
import { professionalsService } from '../../../services/professionals'
import { createOS } from '../../../services/taskService'

export default function NewOS() {
    const navigate = useNavigate()

    // Data
    const [companies, setCompanies] = useState([])
    const [availableFunctions, setAvailableFunctions] = useState([])

    // Form
    const [empresaId, setEmpresaId] = useState('')
    const [titulo, setTitulo] = useState('')
    const [descricao, setDescricao] = useState('')
    const [deadline, setDeadline] = useState('')
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
            // Formata data ISO com Timezone (opcional, ou manda string e EF trata)
            // O input type="datetime-local" retorna 'yyyy-MM-ddTHH:mm'
            const payload = {
                empresa_id: empresaId,
                titulo,
                descricao,
                deadline_at: new Date(deadline).toISOString(),
                funcoes: selectedFunctions
            }

            const result = await createOS(payload)

            toast.success(`OS criada com sucesso! (${result.itemsCreated} microtarefas geradas)`)
            navigate('/admin/tasks')
        } catch (error) {
            console.error(error)
            toast.error(error.message || 'Falha ao criar OS')
        } finally {
            setSubmitting(false)
        }
    }

    // Calcular data mínima (agora)
    const minDate = new Date().toISOString().slice(0, 16)

    return (
        <div className="max-w-3xl mx-auto space-y-8 fade-in p-6 md:p-0">
            {/* Header */}
            <div className="dashboard-header flex items-center gap-4">
                <button
                    onClick={() => navigate('/admin/tasks')}
                    className="btn-icon bg-white hover:bg-slate-50 text-muted hover:text-primary transition-colors"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h2 className="flex items-center gap-2">
                        Nova Ordem de Serviço
                    </h2>
                    <p className="text-muted mt-1">Distribuição automática baseada em Funções.</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="card space-y-6">

                {/* 1. Seleção de Empresa */}
                <div className="form-group">
                    <label className="label flex items-center gap-2">
                        <Building2 size={16} className="text-blue-600" />
                        Selecione a Empresa (Cliente) *
                    </label>
                    <select
                        className="input"
                        value={empresaId}
                        onChange={e => setEmpresaId(e.target.value)}
                        required
                        disabled={loadingCompanies}
                    >
                        <option value="">Selecione...</option>
                        {companies.map(c => (
                            <option key={c.id} value={c.id}>{c.nome}</option>
                        ))}
                    </select>
                </div>

                {/* 2. Funções (Condicional) */}
                {empresaId && (
                    <div className="form-group animate-in fade-in slide-in-from-top-2">
                        <label className="label flex items-center gap-2 mb-3">
                            <Layers size={16} className="text-purple-600" />
                            Funções Necessárias * <span className="text-xs font-normal text-muted">(Selecione as funções que trabalharão nesta OS)</span>
                        </label>

                        {loadingFunctions ? (
                            <div className="text-sm text-slate-500">Buscando funções disponíveis...</div>
                        ) : availableFunctions.length === 0 ? (
                            <div className="p-4 bg-yellow-50 text-yellow-800 border border-yellow-100 rounded-lg text-sm flex items-center gap-2">
                                <AlertTriangle size={16} />
                                Nenhuma função/profissional vinculado a esta empresa. Adicione vínculos no cadastro do profissional primeiro.
                            </div>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {availableFunctions.map(fn => {
                                    const isSelected = selectedFunctions.includes(fn)
                                    return (
                                        <button
                                            key={fn}
                                            type="button"
                                            onClick={() => toggleFunction(fn)}
                                            className={`px-4 py-2 rounded-full text-sm font-medium transition-all border ${isSelected
                                                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm transform scale-105'
                                                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                                                }`}
                                        >
                                            {fn}
                                            {isSelected && <CheckCircle size={14} className="inline ml-1.5 -mt-0.5" />}
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                        <p className="text-xs text-slate-400 mt-2">
                            {selectedFunctions.length} funções selecionadas.
                        </p>
                    </div>
                )}

                <hr className="border-slate-100" />

                {/* 3. Detalhes da OS */}
                <div className="grid grid-cols-1 gap-6">
                    <div className="form-group">
                        <label className="label">Título da OS *</label>
                        <input
                            type="text"
                            className="input"
                            value={titulo}
                            onChange={e => setTitulo(e.target.value)}
                            placeholder="Ex: Campanha de Black Friday"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label className="label">Descrição / Briefing</label>
                        <textarea
                            className="input min-h-[100px]"
                            value={descricao}
                            onChange={e => setDescricao(e.target.value)}
                            placeholder="Detalhes gerais da demanda..."
                        />
                    </div>

                    <div className="form-group">
                        <label className="label flex items-center gap-2">
                            <CalendarIcon size={16} className="text-orange-600" />
                            Prazo de Entrega (Deadline) *
                        </label>
                        <input
                            type="datetime-local"
                            className="input"
                            value={deadline}
                            onChange={e => setDeadline(e.target.value)}
                            min={minDate}
                            required
                        />
                    </div>
                </div>

                {/* Submit */}
                <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={() => navigate('/admin/tasks')}
                        className="btn btn-secondary"
                        disabled={submitting}
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        disabled={submitting || selectedFunctions.length === 0}
                        className="btn btn-primary"
                    >
                        {submitting ? 'Criando OS...' : 'Gerar Ordem de Serviço'}
                    </button>
                </div>
            </form>
        </div>
    )
}
