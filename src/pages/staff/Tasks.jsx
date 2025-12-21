import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import {
    Search,
    Filter,
    ArrowRight,
    Calendar,
    Clock,
    AlertCircle,
    CheckCircle2,
    ArrowUpCircle
} from 'lucide-react'

export default function StaffTasks() {
    const [tasks, setTasks] = useState([])
    const [filteredTasks, setFilteredTasks] = useState([])
    const [loading, setLoading] = useState(true)

    // Filters
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [priorityFilter, setPriorityFilter] = useState('all')

    useEffect(() => {
        fetchTasks()
    }, [])

    useEffect(() => {
        filterTasks()
    }, [search, statusFilter, priorityFilter, tasks])

    async function fetchTasks() {
        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('tarefas')
                .select('*')
                .order('deadline', { ascending: true }) // Upcoming deadlines first

            if (error) throw error
            setTasks(data || [])
        } catch (error) {
            console.error('Error fetching tasks:', error)
        } finally {
            setLoading(false)
        }
    }

    function filterTasks() {
        let result = [...tasks]

        // 1. Status Filter
        if (statusFilter !== 'all') {
            if (statusFilter === 'active') {
                result = result.filter(t => t.status === 'pending' || t.status === 'in_progress')
            } else {
                result = result.filter(t => t.status === statusFilter)
            }
        }

        // 2. Priority Filter
        if (priorityFilter !== 'all') {
            result = result.filter(t => t.priority === priorityFilter)
        }

        // 3. Search
        if (search) {
            const lowerDate = search.toLowerCase()
            result = result.filter(t =>
                t.titulo.toLowerCase().includes(lowerDate) ||
                (t.descricao && t.descricao.toLowerCase().includes(lowerDate))
            )
        }

        setFilteredTasks(result)
    }

    if (loading) {
        return (
            <div className="flex justify-center items-center h-full p-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in pb-12">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-primary mb-2">Minhas Tarefas</h1>
                <p className="text-secondary">Gerencie suas atividades e prazos.</p>
            </div>

            {/* Controls Bar */}
            <div className="card p-4 mb-6 sticky top-4 z-10 backdrop-blur-md bg-white/80 border-gray-100 shadow-sm">
                <div className="flex flex-col md:flex-row gap-4 justify-between">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-tertiary" size={18} />
                        <input
                            type="text"
                            placeholder="Buscar tarefa..."
                            className="input pl-10 w-full"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    <div className="flex gap-2 overflow-x-auto pb-1 md:pb-0">
                        <select
                            className="input w-auto min-w-[140px]"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="all">Todos Status</option>
                            <option value="active">Em Aberto</option>
                            <option value="pending">Pendente</option>
                            <option value="in_progress">Em Andamento</option>
                            <option value="completed">Concluída</option>
                        </select>

                        <select
                            className="input w-auto min-w-[140px]"
                            value={priorityFilter}
                            onChange={(e) => setPriorityFilter(e.target.value)}
                        >
                            <option value="all">Todas Prioridades</option>
                            <option value="urgent">Urgente</option>
                            <option value="high">Alta</option>
                            <option value="medium">Média</option>
                            <option value="low">Baixa</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Tasks Grid */}
            {filteredTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-gray-100 rounded-xl">
                    <div className="w-16 h-16 bg-neutral-50 rounded-full flex items-center justify-center mb-4">
                        <Filter className="text-tertiary opacity-50" size={24} />
                    </div>
                    <h3 className="text-lg font-medium text-secondary mb-1">Nenhuma tarefa encontrada</h3>
                    <p className="text-tertiary">Ajuste os filtros ou busque por outro termo.</p>
                    <button
                        className="btn btn-outline-secondary mt-4"
                        onClick={() => {
                            setSearch('')
                            setStatusFilter('all')
                            setPriorityFilter('all')
                        }}
                    >
                        Limpar Filtros
                    </button>
                </div>
            ) : (
                <div className="grid gap-4">
                    {filteredTasks.map(task => {
                        const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== 'completed'

                        return (
                            <Link
                                to={`/staff/tasks/${task.id}`}
                                key={task.id}
                                className="group card p-0 hover:border-brand-light hover:shadow-md transition-all duration-200 overflow-hidden"
                            >
                                <div className="flex flex-col sm:flex-row">
                                    {/* Left Status Stripe */}
                                    <div className={`w-full sm:w-1.5 h-1 sm:h-auto ${task.status === 'completed' ? 'bg-success' :
                                            isOverdue ? 'bg-danger' :
                                                task.priority === 'urgent' ? 'bg-danger' : 'bg-brand'
                                        }`}></div>

                                    <div className="p-5 flex-1 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-3 mb-1.5">
                                                <h3 className="text-lg font-semibold text-primary truncate pr-4 group-hover:text-brand transition-colors">
                                                    {task.titulo}
                                                </h3>
                                                {isOverdue && (
                                                    <span className="flex-shrink-0 badge badge-danger text-[10px] px-2 py-0.5 uppercase tracking-wide">
                                                        Atrasada
                                                    </span>
                                                )}
                                            </div>

                                            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-secondary">
                                                {task.deadline ? (
                                                    <div className={`flex items-center gap-1.5 ${isOverdue ? 'text-danger font-medium' : ''}`}>
                                                        <Calendar size={15} className="opacity-70" />
                                                        <span>{new Date(task.deadline).toLocaleDateString('pt-BR')}</span>
                                                        <span className="text-tertiary text-xs">
                                                            {new Date(task.deadline).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1.5 text-tertiary">
                                                        <Clock size={15} className="opacity-70" />
                                                        <span>Sem data</span>
                                                    </div>
                                                )}

                                                <div className="flex items-center gap-1.5">
                                                    <ArrowUpCircle size={15} className={`
                                                        ${task.priority === 'urgent' ? 'text-danger' :
                                                            task.priority === 'high' ? 'text-warning' : 'text-tertiary'}
                                                    `} />
                                                    <span className="capitalize">{
                                                        task.priority === 'urgent' ? 'Urgente' :
                                                            task.priority === 'high' ? 'Alta' :
                                                                task.priority === 'medium' ? 'Média' : 'Baixa'
                                                    }</span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-gray-50">
                                            <span className={`px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5 ${task.status === 'completed' ? 'bg-green-50 text-success border-success-subtle' :
                                                    task.status === 'in_progress' ? 'bg-blue-50 text-brand border-blue-100' :
                                                        'bg-gray-50 text-secondary border-gray-200'
                                                }`}>
                                                {task.status === 'completed' ? <CheckCircle2 size={12} /> :
                                                    task.status === 'in_progress' ? <Clock size={12} /> :
                                                        <AlertCircle size={12} />}

                                                {task.status === 'completed' ? 'Concluída' :
                                                    task.status === 'in_progress' ? 'Em andamento' :
                                                        task.status === 'pending' ? 'Pendente' : task.status}
                                            </span>

                                            <div className="text-brand opacity-0 group-hover:opacity-100 transition-opacity transform translate-x-[-10px] group-hover:translate-x-0 hidden sm:block">
                                                <ArrowRight size={20} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </Link>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
