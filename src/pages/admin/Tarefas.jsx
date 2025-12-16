import React, { useState, useEffect } from 'react';
import {
    getAllTasks,
    deleteTask,
    getClients,
    getDepartments,
    getActiveProfessionals
} from '../../services/taskService';
import { Plus, Search, Filter, Calendar as CalendarIcon, Link as LinkIcon } from 'lucide-react';
import TaskFormModal from '../../components/modals/TaskFormModal';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import './Profissionais.css'; // Reusing... should ideally have Shared.css
import './Tarefas.css'; // New specific CSS

const Tarefas = () => {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState({
        search: '',
        status: '',
        cliente_id: '',
        departamento_id: '',
        profissional_id: ''
    });

    // Aux Data
    const [clients, setClients] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [professionals, setProfessionals] = useState([]);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedTask, setSelectedTask] = useState(null);

    const loadAuxData = async () => {
        try {
            const [c, d, p] = await Promise.all([
                getClients(),
                getDepartments(),
                getActiveProfessionals()
            ]);
            setClients(c);
            setDepartments(d);
            setProfessionals(p);
        } catch (error) {
            console.error('Erro ao carregar dados auxiliares:', error);
        }
    };

    const fetchTasks = async () => {
        setLoading(true);
        try {
            const data = await getAllTasks(filters);
            setTasks(data);
        } catch (error) {
            console.error('Erro ao carregar tarefas:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAuxData();
    }, []);

    useEffect(() => {
        fetchTasks();
    }, [filters.status, filters.cliente_id, filters.departamento_id, filters.profissional_id]);
    // Trigger on exact filter changes. Search is debounced ideally, but here manual or on enter?
    // Let's rely on effect deps. "search" update triggers re-fetch if added to deps.
    // For now I'll adding it to deps too but maybe with debounce later.

    // Actually, I'll add a debounce for search or just a search button?
    // Let's add it to deps for instant search.

    const handleFilterChange = (e) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            fetchTasks();
        }, 500);
        return () => clearTimeout(timer);
    }, [filters.search]);

    const handleAdd = () => {
        setSelectedTask(null);
        setIsModalOpen(true);
    };

    const handleEdit = (task) => {
        setSelectedTask(task);
        setIsModalOpen(true);
    };

    const handleModalClose = () => {
        setIsModalOpen(false);
        setSelectedTask(null);
    };

    const handleModalSave = async () => {
        await fetchTasks();
        handleModalClose();
    };

    const getStatusBadge = (status) => {
        const map = {
            pendente: { label: 'Pendente', class: 'badge-pending' },
            em_andamento: { label: 'Em Andamento', class: 'badge-progress' },
            concluida: { label: 'Concluída', class: 'badge-completed' }
        };
        const info = map[status] || { label: status, class: '' };
        return <span className={`status-badge ${info.class}`}>{info.label}</span>;
    };

    const getPriorityIcon = (priority) => {
        const map = {
            alta: { color: '#ef4444', label: 'Alta' },
            media: { color: '#f59e0b', label: 'Média' },
            baixa: { color: '#10b981', label: 'Baixa' }
        };
        const info = map[priority] || map.media;
        return <span className="priority-dot" title={info.label}></span>;
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <h1>Tarefas</h1>
                <button className="btn-primary" onClick={handleAdd}>
                    <Plus size={20} />
                    <span>Nova Tarefa</span>
                </button>
            </div>

            {/* Filters */}
            <div className="filters-container">
                <div className="search-box">
                    <Search size={18} />
                    <input
                        type="text"
                        name="search"
                        placeholder="Buscar tarefa..."
                        value={filters.search}
                        onChange={handleFilterChange}
                    />
                </div>

                <select name="status" value={filters.status} onChange={handleFilterChange} className="filter-select">
                    <option value="">Status: Todos</option>
                    <option value="pendente">Pendente</option>
                    <option value="em_andamento">Em Andamento</option>
                    <option value="concluida">Concluída</option>
                </select>

                <select name="cliente_id" value={filters.cliente_id} onChange={handleFilterChange} className="filter-select">
                    <option value="">Cliente: Todos</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>

                <select name="departamento_id" value={filters.departamento_id} onChange={handleFilterChange} className="filter-select">
                    <option value="">Depto: Todos</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
                </select>

                <select name="profissional_id" value={filters.profissional_id} onChange={handleFilterChange} className="filter-select">
                    <option value="">Profissional: Todos</option>
                    {professionals.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
            </div>

            {/* Task List */}
            {loading ? (
                <div className="loading">Carregando tarefas...</div>
            ) : (
                <div className="tasks-grid">
                    {tasks.length === 0 ? (
                        <div className="empty-state">Nenhuma tarefa encontrada.</div>
                    ) : (
                        tasks.map(task => (
                            <div key={task.id} className="task-card" onClick={() => handleEdit(task)}>
                                <div className="task-header">
                                    <div className="task-badges">
                                        {getStatusBadge(task.status)}
                                        {task.departamentos && (
                                            <span
                                                className="dept-badge"
                                                style={{ color: task.departamentos.cor_hex, backgroundColor: task.departamentos.cor_hex + '20' }}
                                            >
                                                {task.departamentos.nome}
                                            </span>
                                        )}
                                    </div>
                                    {getPriorityIcon(task.prioridade)}
                                </div>
                                <h3 className="task-title">{task.titulo}</h3>
                                <div className="task-info">
                                    <span className="info-item">
                                        <Briefcase size={14} /> {task.clientes?.nome}
                                    </span>
                                    {task.profissionais && (
                                        <span className="info-item">
                                            <Filter size={14} /> {task.profissionais.nome}
                                        </span>
                                    )}
                                </div>
                                <div className="task-footer">
                                    <div className="deadline">
                                        <CalendarIcon size={14} />
                                        {format(new Date(task.deadline), "d 'de' MMM, HH:mm", { locale: ptBR })}
                                    </div>
                                    {/* Links Indicator */}
                                    <div className="links-indicator">
                                        {(task.research_link || task.final_link) && <LinkIcon size={14} />}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {isModalOpen && (
                <TaskFormModal
                    isOpen={isModalOpen}
                    onClose={handleModalClose}
                    onSave={handleModalSave}
                    task={selectedTask}
                    clients={clients}
                    departments={departments}
                    professionals={professionals}
                />
            )}
        </div>
    );
};

export default Tarefas;
