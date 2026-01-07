import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import {
    Activity,
    CheckCircle,
    Clock,
    AlertTriangle,
    Building2,
    LayoutDashboard,
    ArrowUpRight
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from 'sonner'

export default function Dashboard() {
    const navigate = useNavigate()
    const { user } = useAuth()

    // Multi-tenant State
    const [companies, setCompanies] = useState([])
    const [selectedCompanyId, setSelectedCompanyId] = useState(null)
    const [loadingCompanies, setLoadingCompanies] = useState(true)

    // Dashboard Data State
    const [data, setData] = useState(null)
    const [loadingData, setLoadingData] = useState(false)
    const [error, setError] = useState(null)

    // 1. Initialize: Fetch User's Companies
    useEffect(() => {
        if (!user) return

        async function fetchUserCompanies() {
            try {
                setLoadingCompanies(true)

                // Get companies linked to this professional
                const { data: links, error: linksError } = await supabase
                    .from('empresa_profissionais')
                    .select(`
                        empresa_id,
                        empresas ( id, nome, slug, logo_url )
                    `)
                    .eq('profissional_id', user.id)
                    .eq('ativo', true)

                if (linksError) throw linksError

                const validCompanies = links
                    ?.map(l => l.empresas)
                    .filter(Boolean) || []

                if (validCompanies.length === 0) {
                    setError('Você não está vinculado a nenhuma empresa.')
                    return
                }

                setCompanies(validCompanies)

                // 2. Select Active Company (Priority: LocalStorage > URL > First)
                const storedId = localStorage.getItem('@FlowOS:dashboard_empresa_id')
                const urlParams = new URLSearchParams(window.location.search)
                const urlId = urlParams.get('empresa_id')

                let targetId = validCompanies[0].id

                if (urlId && validCompanies.find(c => c.id === urlId)) {
                    targetId = urlId
                } else if (storedId && validCompanies.find(c => c.id === storedId)) {
                    targetId = storedId
                }

                setSelectedCompanyId(targetId)

            } catch (err) {
                console.error('Error loading companies:', err)
                setError('Erro ao carregar empresas.')
            } finally {
                setLoadingCompanies(false)
            }
        }

        fetchUserCompanies()
    }, [user])

    // 3. Fetch Dashboard Data when Company Changes
    useEffect(() => {
        if (!selectedCompanyId) return

        // Persist selection
        localStorage.setItem('@FlowOS:dashboard_empresa_id', selectedCompanyId)

        async function loadDashboard() {
            try {
                setLoadingData(true)
                setError(null)

                // Calls the secure RPC
                const { data: rpcData, error: rpcError } = await supabase
                    .rpc('get_dashboard_data', {
                        p_empresa_id: selectedCompanyId
                    })

                if (rpcError) throw rpcError

                setData(rpcData)
            } catch (err) {
                console.error('Error fetching dashboard:', err)
                setError('Erro ao carregar dados do dashboard.')
                toast.error('Falha ao atualizar dados')
            } finally {
                setLoadingData(false)
            }
        }

        loadDashboard()
    }, [selectedCompanyId])

    const handleCompanyChange = (e) => {
        setSelectedCompanyId(e.target.value)
    }

    if (loadingCompanies) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-50">
                <div className="flex flex-col items-center gap-3">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    <p className="text-gray-500 font-medium">Carregando perfil...</p>
                </div>
            </div>
        )
    }

    if (error && !data) {
        return (
            <div className="p-8 max-w-2xl mx-auto mt-10">
                <div className="bg-red-50 border border-red-200 rounded-lg p-6 flex flex-col items-center text-center">
                    <AlertTriangle className="h-10 w-10 text-red-500 mb-2" />
                    <h3 className="text-lg font-semibold text-red-800">Acesso Indisponível</h3>
                    <p className="text-red-600 mt-1">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors"
                    >
                        Tentar Novamente
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50/50 p-6 space-y-6 animate-in fade-in duration-500">
            {/* Header with Company Selector */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <LayoutDashboard className="h-6 w-6 text-indigo-600" />
                        Visão Executiva
                    </h1>
                    <p className="text-slate-500 mt-1">
                        Acompanhamento estratégico e operacional.
                    </p>
                </div>

                <div className="flex items-center gap-3 bg-white p-2 rounded-lg border border-gray-200 shadow-sm">
                    <div className="p-2 bg-indigo-50 rounded-md">
                        <Building2 className="h-5 w-5 text-indigo-600" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            Empresa
                        </span>
                        {companies.length > 1 ? (
                            <select
                                value={selectedCompanyId || ''}
                                onChange={handleCompanyChange}
                                className="text-sm font-semibold text-slate-700 bg-transparent border-none p-0 pr-6 focus:ring-0 cursor-pointer outline-none"
                            >
                                {companies.map(c => (
                                    <option key={c.id} value={c.id}>{c.nome}</option>
                                ))}
                            </select>
                        ) : (
                            <span className="text-sm font-semibold text-slate-700">
                                {companies[0]?.nome}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {loadingData ? (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse"></div>
                    ))}
                </div>
            ) : data ? (
                <>
                    {/* KPIs Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <KpiCard
                            title="Total de Tarefas"
                            value={data.summary.total}
                            icon={<LayoutDashboard />}
                            color="indigo"
                        />
                        <KpiCard
                            title="Em Execução"
                            value={data.summary.active}
                            icon={<Activity />}
                            color="blue"
                        />
                        <KpiCard
                            title="Concluídas"
                            value={data.summary.completed}
                            icon={<CheckCircle />}
                            color="emerald"
                        />
                        <KpiCard
                            title="Atrasadas"
                            value={data.summary.overdue}
                            icon={<AlertTriangle />}
                            color="red"
                            isAlert={data.summary.overdue > 0}
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Main Chart / Recent Tasks Area */}
                        <div className="lg:col-span-2 space-y-6">
                            {/* Graphic Placeholder using Recharts if needed, or simple list for now */}
                            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                                <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                                    <Clock className="h-5 w-5 text-slate-400" />
                                    Tarefas Recentes
                                </h3>
                                <div className="space-y-3">
                                    {data.recent_tasks.length === 0 ? (
                                        <p className="text-slate-500 py-4 text-center">Nenhuma tarefa recente.</p>
                                    ) : (
                                        data.recent_tasks.map(task => (
                                            <div key={task.id} className="group flex items-center justify-between p-3 hover:bg-slate-50 rounded-lg border border-transparent hover:border-slate-100 transition-all cursor-pointer" onClick={() => navigate(`/admin/tarefas/${task.id}`)}>
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-2 h-2 rounded-full ${getPriorityColor(task.priority)}`} title={`Prioridade: ${task.priority}`} />
                                                    <div>
                                                        <h4 className="text-sm font-medium text-slate-800 group-hover:text-indigo-600 transition-colors">
                                                            {task.titulo}
                                                        </h4>
                                                        <span className="text-xs text-slate-400">
                                                            {new Date(task.created_at).toLocaleDateString()}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadge(task.status)}`}>
                                                        {task.status}
                                                    </span>
                                                    <ArrowUpRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-600" />
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Productivity / Stats Column */}
                        <div className="space-y-6">
                            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 h-full">
                                <h3 className="text-lg font-semibold text-slate-800 mb-4">Produtividade</h3>
                                <div className="space-y-4">
                                    {data.productivity.map(p => (
                                        <div key={p.id} className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
                                                    {p.nome.charAt(0)}
                                                </div>
                                                <span className="text-sm font-medium text-slate-700">{p.nome}</span>
                                            </div>
                                            <div className="flex gap-2 text-xs font-mono">
                                                <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded" title="Em andamento">{p.active_count}</span>
                                                <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded" title="Concluídas">{p.completed_count}</span>
                                            </div>
                                        </div>
                                    ))}
                                    {data.productivity.length === 0 && (
                                        <p className="text-slate-400 text-sm">Nenhum dado disponível.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            ) : null}
        </div>
    )
}

// Sub-components & Helpers

function KpiCard({ title, value, icon, color, isAlert }) {
    const colors = {
        indigo: 'bg-indigo-50 text-indigo-600',
        blue: 'bg-blue-50 text-blue-600',
        emerald: 'bg-emerald-50 text-emerald-600',
        red: 'bg-red-50 text-red-600'
    }

    return (
        <div className={`bg-white rounded-xl p-6 border transition-all ${isAlert ? 'border-red-200 shadow-red-100/50 shadow-lg' : 'border-gray-100 shadow-sm'}`}>
            <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-slate-500">{title}</span>
                <div className={`p-2 rounded-lg ${colors[color] || colors.indigo}`}>
                    {React.cloneElement(icon, { size: 20 })}
                </div>
            </div>
            <div className="flex items-baseline gap-2">
                <h3 className={`text-3xl font-bold ${isAlert ? 'text-red-600' : 'text-slate-800'}`}>
                    {value}
                </h3>
            </div>
        </div>
    )
}

function getPriorityColor(priority) {
    switch (priority) {
        case 'urgent': return 'bg-red-500'
        case 'high': return 'bg-orange-500'
        case 'medium': return 'bg-yellow-500'
        default: return 'bg-blue-300'
    }
}

function getStatusBadge(status) {
    const styles = {
        completed: 'bg-emerald-100 text-emerald-700',
        done: 'bg-emerald-100 text-emerald-700',
        concluida: 'bg-emerald-100 text-emerald-700',
        in_progress: 'bg-blue-100 text-blue-700',
        pending: 'bg-slate-100 text-slate-700',
        overdue: 'bg-red-100 text-red-700'
    }
    return styles[status] || 'bg-gray-100 text-gray-700'
}
