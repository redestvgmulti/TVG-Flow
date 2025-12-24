
import { useState, useEffect } from 'react'
import { CheckCircle, AlertTriangle, Layers, Building2, Calendar as CalendarIcon } from 'lucide-react'
import { toast } from 'sonner'
import { clientService } from '../../services/clientService'
import { professionalsService } from '../../services/professionals'
import { createOS } from '../../services/taskService'

export default function TaskForm({ onSuccess, onCancel }) {
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
            const payload = {
                empresa_id: empresaId,
                titulo,
                descricao,
                deadline_at: new Date(deadline).toISOString(),
                funcoes: selectedFunctions
            }

            const result = await createOS(payload)

            toast.success(`OS criada com sucesso! (${result.itemsCreated} microtarefas geradas)`)

            if (onSuccess) {
                onSuccess(result)
            }
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
        <form onSubmit={handleSubmit} className="space-y-6">

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
            {/* 2. Funções (Condicional) */}
            {empresaId && (
                <div className="form-group animate-in fade-in slide-in-from-top-2">
                    <label className="label flex items-center gap-2 mb-3 text-slate-700 font-medium">
                        <Layers size={16} className="text-indigo-600" />
                        Funções Necessárias * <span className="text-xs font-normal text-slate-400">(Selecione as funções)</span>
                    </label>

                    {loadingFunctions ? (
                        <div className="text-sm text-slate-500 flex items-center gap-2 py-2">
                            <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                            Buscando funções disponíveis...
                        </div>
                    ) : availableFunctions.length === 0 ? (
                        <div className="p-4 bg-amber-50 text-amber-800 border border-amber-100 rounded-xl text-sm flex items-center gap-3">
                            <AlertTriangle size={18} className="shrink-0" />
                            <span>Nenhuma função vinculada a esta empresa.</span>
                        </div>
                    ) : (
                        <>
                            <div className="relative group">
                                {/* Gradient masks for scroll indication */}
                                <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-white to-transparent pointer-events-none z-10" />
                                <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-l from-white to-transparent pointer-events-none z-10" />

                                <div className="overflow-x-auto pb-3 -mx-2 px-2 hide-scrollbar">
                                    <div className="flex gap-2 min-w-max">
                                        {availableFunctions.map(fn => {
                                            const isSelected = selectedFunctions.includes(fn)
                                            return (
                                                <button
                                                    key={fn}
                                                    type="button"
                                                    onClick={() => toggleFunction(fn)}
                                                    className={`
                                                        relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 border whitespace-nowrap select-none
                                                        ${isSelected
                                                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm'
                                                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                                        }
                                                    `}
                                                >
                                                    <span className="relative z-10">{fn}</span>
                                                    {isSelected && (
                                                        <div className="bg-indigo-600 rounded-full p-0.5 text-white animate-in zoom-in-50 duration-200">
                                                            <CheckCircle size={12} strokeWidth={3} />
                                                        </div>
                                                    )}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                            <p className="text-xs text-slate-400 mt-1 pl-1">
                                {selectedFunctions.length} {selectedFunctions.length === 1 ? 'função selecionada' : 'funções selecionadas'}
                            </p>
                        </>
                    )}
                </div>
            )}

            <div className="h-px bg-slate-100 my-6" />

            {/* 3. Detalhes da OS */}
            <div className="grid grid-cols-1 gap-5">
                <div className="form-group">
                    <label className="label text-slate-700 font-medium mb-1.5 block">Título da OS *</label>
                    <input
                        type="text"
                        className="input w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all outline-none text-slate-700 placeholder:text-slate-400"
                        value={titulo}
                        onChange={e => setTitulo(e.target.value)}
                        placeholder="Ex: Campanha de Black Friday"
                        required
                    />
                </div>

                <div className="form-group">
                    <label className="label text-slate-700 font-medium mb-1.5 block">Descrição / Briefing</label>
                    <textarea
                        className="input w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all outline-none text-slate-700 placeholder:text-slate-400 min-h-[100px] resize-y"
                        value={descricao}
                        onChange={e => setDescricao(e.target.value)}
                        placeholder="Detalhes gerais da demanda..."
                    />
                </div>

                <div className="form-group">
                    <label className="label flex items-center gap-2 text-slate-700 font-medium mb-1.5">
                        <CalendarIcon size={16} className="text-orange-500" />
                        Prazo de Entrega (Deadline) *
                    </label>
                    <input
                        type="datetime-local"
                        className="input w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all outline-none text-slate-700"
                        value={deadline}
                        onChange={e => setDeadline(e.target.value)}
                        min={minDate}
                        required
                    />
                </div>
            </div>

            {/* Submit */}
            <div className="pt-4 border-t border-slate-100 flex justify-end gap-3">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="btn btn-secondary"
                        disabled={submitting}
                    >
                        Cancelar
                    </button>
                )}
                <button
                    type="submit"
                    disabled={submitting || selectedFunctions.length === 0}
                    className="btn btn-primary"
                >
                    {submitting ? 'Criando OS...' : 'Gerar Ordem de Serviço'}
                </button>
            </div>
        </form>
    )
}
