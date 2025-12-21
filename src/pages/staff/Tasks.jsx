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
                <div className="flex flex-col gap-4">
                    {filteredTasks.map(task => {
                        const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== 'completed'

                        return (
                            <Link
                                to={`/staff/tasks/${task.id}`}
                                key={task.id}
                                className="block card p-5 hover:border-brand-light transition-all duration-200 group relative overflow-hidden text-left"
                            >
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex flex-wrap items-center gap-2 mb-2">
                                            <h3 className="font-semibold text-primary group-hover:text-brand transition-colors text-base truncate max-w-full">
                                                {task.titulo}
                                            </h3>
                                            {isOverdue && (
                                                <span className="badge badge-danger text-[10px] px-1.5 py-0.5 uppercase tracking-wide">
                                                    Atrasada
                                                </span>
                                            )}
                                            <span className={`badge ${task.priority === 'urgent' ? 'badge-danger' :
                                                task.priority === 'high' ? 'badge-warning' : 'badge-neutral'
                                                } text-[10px] px-1.5 py-0.5`}>
                                                {task.priority === 'urgent' ? 'Urgente' :
                                                    task.priority === 'high' ? 'Alta' :
                                                        task.priority === 'medium' ? 'Média' : 'Baixa'}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-4 text-sm text-secondary">
                                            {task.deadline && (
                                                <span className={`flex items-center gap-1.5 ${isOverdue ? 'text-danger' : ''}`}>
                                                    <Calendar size={14} className="opacity-70" />
                                                    {new Date(task.deadline).toLocaleDateString('pt-BR')}
                                                    <span className="text-tertiary">
                                                        às {new Date(task.deadline).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between md:justify-end gap-3 mt-2 md:mt-0 pt-3 md:pt-0 border-t border-gray-50 md:border-0 w-full md:w-auto">
                                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border flex items-center gap-1.5 ${task.status === 'completed' ? 'bg-green-50 text-success border-success-subtle' :
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

                                        <div className="text-brand opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity transform md:translate-x-[-10px] group-hover:translate-x-0">
                                            <ArrowRight size={18} />
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
