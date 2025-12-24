
import { useState, useEffect } from 'react'
import { CheckCircle, AlertTriangle, Layers, Building2, Calendar as CalendarIcon } from 'lucide-react'
import { toast } from 'sonner'
import { clientService } from '../../services/clientService'
import { professionalsService } from '../../services/professionals'
import { createOS } from '../../services/taskService'
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



    // ... imports

    const handleSubmit = async (e) => {
        e.preventDefault()

        if (!empresaId || !titulo || selectedFunctions.length === 0 || !deadline) {
            toast.error('Preencha todos os campos obrigatórios')
            return
        }

        setSubmitting(true)
        try {
            // Client-side implementation of "create-os-by-function"
            // Logic:
            // 1. Iterate functions
            // 2. Find professionals
            // 3. Create Task
            // 4. Create Notification
            // 5. Send Push

            let itemsCreated = 0
            let notificationsSent = 0

            for (const funcao of selectedFunctions) {
                // 1. Find professionals for this company/function
                const { data: links, error: linkError } = await supabase
                    .from('empresa_profissionais')
                    .select(`
                        profissional_id,
                        profissionais!inner (
                            id,
                            departamento_id,
                            nome
                        )
                    `)
                    .eq('empresa_id', empresaId)
                    .eq('funcao', funcao)
                    .eq('ativo', true)

                if (linkError) {
                    console.error(`Erro ao buscar profissionais para ${funcao}:`, linkError)
                    continue
                }

                if (!links || links.length === 0) {
                    console.warn(`Nenhum profissional encontrado para: ${funcao}`)
                    continue
                }

                // 2. Create for each professional
                for (const link of links) {
                    const professional = link.profissionais
                    if (!professional) continue

                    // Create Task
                    const taskPayload = {
                        titulo: `${titulo} - ${funcao}`,
                        descricao: descricao,
                        cliente_id: empresaId,
                        assigned_to: professional.id,
                        departamento_id: professional.departamento_id,
                        prioridade: prioridade,
                        deadline: new Date(deadline).toISOString(),
                        status: 'pendente'
                    }

                    const { data: task, error: taskError } = await supabase
                        .from('tarefas')
                        .insert(taskPayload)
                        .select()
                        .single()

                    if (taskError) {
                        console.error('Erro ao criar tarefa:', taskError)
                        continue
                    }
                    itemsCreated++

                    // 3. Create In-App Notification
                    const notificationPayload = {
                        profissional_id: professional.id,
                        title: 'Nova Tarefa Atribuída',
                        message: `Você recebeu uma nova tarefa de ${funcao}: "${titulo}"`,
                        type: 'task_assigned',
                        link: `/staff/tasks/${task.id}`,
                        read: false,
                        created_at: new Date().toISOString()
                    }

                    const { data: notif, error: notifError } = await supabase
                        .from('notifications')
                        .insert(notificationPayload)
                        .select()
                        .single()

                    if (!notifError && notif) {
                        // 4. Trigger Push Notification (via Edge Function that exists)
                        // We use the existing 'send-push-notification' function which takes a notificationId
                        try {
                            const { error: pushError } = await supabase.functions.invoke('send-push-notification', {
                                body: { notificationId: notif.id }
                            })
                            if (pushError) console.error('Push error:', pushError)
                            else notificationsSent++
                        } catch (err) {
                            console.error('Push invoke error:', err)
                        }
                    }
                }
            }

            if (itemsCreated === 0) {
                toast.warning('Nenhuma tarefa foi cria. Verifique se há profissionais vinculados às funções selecionadas.')
            } else {
                toast.success(`OS criada com sucesso! (${itemsCreated} tarefas geradas)`)
                if (onSuccess) {
                    onSuccess({ itemsCreated })
                }
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

        <form onSubmit={handleSubmit} className="form-section-spacing">

            {/* 1. Seleção de Empresa */}
            <div className="space-y-1">
                <label className="label-premium flex items-center gap-2">
                    <Building2 size={16} className="text-indigo-600" />
                    Cliente (Empresa)
                </label>
                <div className="relative">
                    <select
                        className="input-premium appearance-none cursor-pointer hover:border-indigo-300"
                        value={empresaId}
                        onChange={e => setEmpresaId(e.target.value)}
                        required
                        disabled={loadingCompanies}
                    >
                        <option value="">Selecione uma empresa...</option>
                        {companies.map(c => (
                            <option key={c.id} value={c.id}>{c.nome}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* 2. Funções (Condicional) */}
            {empresaId && (
                <div className="animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-baseline justify-between mb-2">
                        <label className="label-premium flex items-center gap-2 text-slate-700">
                            <Layers size={16} className="text-indigo-600" />
                            Funções Necessárias
                        </label>
                        <span className="text-xs text-slate-400 font-medium hidden md:inline">Selecione as funções para distribuição</span>
                    </div>

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
                                <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white to-transparent pointer-events-none z-10" />
                                <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent pointer-events-none z-10" />

                                <div className="pb-2 -mx-2 px-2">
                                    <div className="chip-group">
                                        {availableFunctions.map(fn => {
                                            const isSelected = selectedFunctions.includes(fn)
                                            return (
                                                <button
                                                    key={fn}
                                                    type="button"
                                                    onClick={() => toggleFunction(fn)}
                                                    className={`chip-premium ${isSelected ? 'selected' : ''}`}
                                                >
                                                    <span className="relative z-10 whitespace-nowrap">{fn}</span>
                                                    {isSelected && (
                                                        <div className="chip-check-icon">
                                                            <CheckCircle size={10} strokeWidth={4} />
                                                        </div>
                                                    )}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-2 mt-2 pl-1">
                                <div className="h-1 flex-1 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-indigo-500 transition-all duration-500"
                                        style={{ width: `${(selectedFunctions.length / (availableFunctions.length || 1)) * 100}%` }}
                                    />
                                </div>
                                <p className="text-xs font-medium text-slate-400 whitespace-nowrap">
                                    {selectedFunctions.length} selecionadas
                                </p>
                            </div>
                        </>
                    )}
                </div>
            )}

            <div className="divider-subtle" />

            {/* 3. Detalhes da OS */}
            <div className="space-y-6">
                <div className="space-y-1">
                    <label className="label-premium">Título da Demanda</label>
                    <input
                        type="text"
                        className="input-premium"
                        value={titulo}
                        onChange={e => setTitulo(e.target.value)}
                        placeholder="Ex: Campanha de Black Friday"
                        required
                    />
                </div>

                <div className="space-y-1">
                    <label className="label-premium">Descrição / Briefing</label>
                    <textarea
                        className="input-premium min-h-[140px] resize-y leading-relaxed"
                        value={descricao}
                        onChange={e => setDescricao(e.target.value)}
                        placeholder="Detalhes gerais da demanda..."
                    />
                </div>

                <div className="space-y-1">
                    <label className="label-premium">Prioridade</label>
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
                    <p className="text-xs text-slate-400 mt-1">Define a urgência da demanda</p>
                </div>

                <div className="space-y-1">
                    <label className="label-premium flex items-center gap-2">
                        <CalendarIcon size={16} className="text-indigo-600" />
                        Deadline (Prazo Final)
                    </label>
                    <input
                        type="datetime-local"
                        className="input-premium"
                        value={deadline}
                        onChange={e => setDeadline(e.target.value)}
                        min={minDate}
                        required
                    />
                </div>
            </div>

            {/* Submit */}
            <div className="form-actions-premium">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="btn btn-ghost text-slate-500 hover:text-slate-800"
                        disabled={submitting}
                    >
                        Cancelar
                    </button>
                )}
                <button
                    type="submit"
                    disabled={submitting || selectedFunctions.length === 0}
                    className="btn btn-primary px-8 py-3 text-base shadow-lg shadow-indigo-500/20"
                >
                    {submitting ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Processando...
                        </>
                    ) : (
                        <>
                            <span className="md:hidden">Gerar OS</span>
                            <span className="hidden md:inline">Gerar Ordem de Serviço</span>
                        </>
                    )}
                </button>
            </div>
        </form>
    )
}


