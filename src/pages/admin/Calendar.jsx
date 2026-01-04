import { useState, useEffect, useMemo } from 'react'
import { Calendar as BigCalendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import ptBR from 'date-fns/locale/pt-BR'
import { supabase } from '../../services/supabase'
import { Calendar as CalendarIcon, Clock, User, ExternalLink, AlertCircle, CheckCircle } from 'lucide-react'
import 'react-big-calendar/lib/css/react-big-calendar.css'

const localizer = dateFnsLocalizer({
    format,
    parse,
    startOfWeek,
    getDay,
    locales: {
        'pt-BR': ptBR
    },
})

const messages = {
    allDay: 'Dia inteiro',
    previous: 'Anterior',
    next: 'Próximo',
    today: 'Hoje',
    month: 'Mês',
    week: 'Semana',
    day: 'Dia',
    agenda: 'Agenda',
    date: 'Data',
    time: 'Hora',
    event: 'Evento',
    noEventsInRange: 'Não há eventos neste período.',
    showMore: total => `+ Ver mais (${total})`
}

function Calendar() {
    const [tasks, setTasks] = useState([])
    const [professionals, setProfessionals] = useState([])
    const [loading, setLoading] = useState(true)
    const [selectedTask, setSelectedTask] = useState(null)
    const [showDetailModal, setShowDetailModal] = useState(false)
    const [view, setView] = useState('month')
    const [date, setDate] = useState(new Date())

    useEffect(() => {
        fetchData()
    }, [])

    async function fetchData() {
        try {
            setLoading(true)

            const [tasksResult, profsResult] = await Promise.all([
                supabase
                    .from('tarefas')
                    .select('id, titulo, deadline, status, priority, assigned_to, drive_link, created_at, descricao')
                    .order('deadline'),
                supabase
                    .from('profissionais')
                    .select('id, nome')
            ])

            if (tasksResult.error) throw tasksResult.error
            if (profsResult.error) throw profsResult.error

            setTasks(tasksResult.data || [])
            setProfessionals(profsResult.data || [])
        } catch (error) {
            console.error('Error fetching calendar data:', error)
        } finally {
            setLoading(false)
        }
    }

    const events = useMemo(() => {
        return tasks.map(task => {
            const deadline = new Date(task.deadline)
            const isOverdue = deadline < new Date() && task.status !== 'completed'

            let color = '#007aff' // blue - default
            if (task.status === 'completed') {
                color = '#34c759' // green
            } else if (isOverdue) {
                color = '#ff3b30' // red
            }

            // Fix for "All Day" issue:
            // 1. Never assume 00:00:00 is allDay
            // 2. Default duration is 1 hour for visibility
            // 3. Only set allDay if explicit property exists (defensive)

            const start = deadline
            const end = new Date(deadline.getTime() + 60 * 60 * 1000) // +1 hour artificial duration

            // Check for explicit all_day flag (if it exists in future DB updates)
            const hasExplicitAllDay = task.all_day === true || task.is_all_day === true

            return {
                id: task.id,
                title: task.titulo,
                start: start,
                end: end,
                allDay: hasExplicitAllDay,
                resource: task,
                style: {
                    backgroundColor: color,
                    borderColor: color
                }
            }
        })
    }, [tasks])

    function handleSelectEvent(event) {
        setSelectedTask(event.resource)
        setShowDetailModal(true)
    }

    function getAssignedToName(assignedToId) {
        const prof = professionals.find(p => p.id === assignedToId)
        return prof ? prof.nome : 'Não atribuído'
    }

    const eventStyleGetter = (event) => {
        return {
            style: event.style
        }
    }

    if (loading) {
        return (
            <div className="animation-fade-in">
                <div className="dashboard-header">
                    <h2>Calendário de Tarefas</h2>
                </div>
                <div className="card loading-card">
                    <p className="loading-text-primary">Carregando calendário...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in">
            <div className="dashboard-header">
                <h2>Calendário de Tarefas</h2>
            </div>

            <div className="card calendar-container">
                <BigCalendar
                    localizer={localizer}
                    events={events}
                    startAccessor="start"
                    endAccessor="end"
                    className="calendar-full-height"
                    onSelectEvent={handleSelectEvent}
                    eventPropGetter={eventStyleGetter}
                    views={['month', 'week', 'agenda']}
                    view={view}
                    date={date}
                    onView={setView}
                    onNavigate={setDate}
                    selectable
                    messages={messages}
                    culture="pt-BR"
                />
            </div>

            {/* Task Detail Modal */}
            {showDetailModal && selectedTask && (
                <div className="modal-backdrop" onClick={() => setShowDetailModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Detalhes da Tarefa</h3>
                            <button className="modal-close" onClick={() => setShowDetailModal(false)}>×</button>
                        </div>
                        <div className="modal-body">
                            <div className="detail-group">
                                <label>Título</label>
                                <p className="detail-value">{selectedTask.titulo}</p>
                            </div>

                            <div className="detail-group">
                                <label>Descrição</label>
                                <p className="detail-value" style={{ whiteSpace: 'pre-wrap' }}>
                                    {selectedTask.descricao || 'Sem descrição'}
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="detail-group">
                                    <label>Status</label>
                                    <span className={`badge badge-${selectedTask.status === 'completed' ? 'success' : selectedTask.status === 'in_progress' ? 'primary' : 'neutral'} flex items-center gap-1 w-fit`}>
                                        {selectedTask.status === 'completed' && <CheckCircle size={12} />}
                                        {selectedTask.status === 'completed' ? 'Concluída' : selectedTask.status === 'in_progress' ? 'Em Andamento' : 'Pendente'}
                                    </span>
                                </div>

                                <div className="detail-group">
                                    <label>Prioridade</label>
                                    <span className={`badge badge-${selectedTask.priority === 'urgent' ? 'danger' : selectedTask.priority === 'high' ? 'warning' : 'neutral'} flex items-center gap-1 w-fit`}>
                                        {selectedTask.priority === 'urgent' && <AlertCircle size={12} />}
                                        {selectedTask.priority === 'urgent' ? 'Urgente' : selectedTask.priority === 'high' ? 'Alta' : 'Normal'}
                                    </span>
                                </div>
                            </div>

                            <div className="detail-group">
                                <label>Responsável</label>
                                <div className="flex items-center gap-2 mt-1">
                                    <div className="avatar-placeholder w-8 h-8 text-xs">
                                        {getAssignedToName(selectedTask.assigned_to)?.charAt(0) || '?'}
                                    </div>
                                    <p className="detail-value mb-0">
                                        {getAssignedToName(selectedTask.assigned_to)}
                                    </p>
                                </div>
                            </div>

                            {selectedTask.drive_link && (
                                <div className="detail-group">
                                    <label>Link do Drive</label>
                                    <a
                                        href={selectedTask.drive_link}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary flex items-center gap-2 hover:underline"
                                    >
                                        <ExternalLink size={16} />
                                        Acessar Arquivos
                                    </a>
                                </div>
                            )}

                            <div className="detail-group">
                                <label>Prazos</label>
                                <p className="text-sm text-muted flex items-center gap-2">
                                    <CalendarIcon size={14} />
                                    Criado em: {new Date(selectedTask.created_at || new Date()).toLocaleDateString()}
                                </p>
                                <p className="text-sm text-muted flex items-center gap-2">
                                    <Clock size={14} />
                                    Vencimento: {new Date(selectedTask.deadline).toLocaleDateString()}
                                </p>
                            </div>
                        </div>

                        <div className="modal-footer">
                            <button
                                onClick={() => setShowDetailModal(false)}
                                className="btn btn-secondary w-full"
                            >
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Calendar
