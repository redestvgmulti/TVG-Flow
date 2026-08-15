import { useState, useEffect } from 'react'
import { Calendar as BigCalendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import ptBR from 'date-fns/locale/pt-BR'
import { useAuth } from '../../contexts/AuthContext'
import { fetchStaffCalendarEvents } from '../../services/calendarService'
import { Calendar as CalendarIcon, Clock, ExternalLink, AlertCircle, CheckCircle } from 'lucide-react'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import '../../styles/calendar.css'
import CreatorSignature from '../../components/ui/CreatorSignature'

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

function StaffCalendar() {
    const { user } = useAuth()
    const [events, setEvents] = useState([])
    const [loading, setLoading] = useState(true)
    const [selectedEvent, setSelectedEvent] = useState(null)
    const [showDetailModal, setShowDetailModal] = useState(false)
    const [view, setView] = useState('month')
    const [date, setDate] = useState(new Date())

    useEffect(() => {
        if (user?.id) {
            fetchData()
        }
    }, [user?.id])

    async function fetchData() {
        try {
            setLoading(true)
            const calendarEvents = await fetchStaffCalendarEvents(user.id)
            setEvents(calendarEvents)
        } catch (error) {
            console.error('Error fetching staff calendar data:', error)
        } finally {
            setLoading(false)
        }
    }

    function handleSelectEvent(event) {
        setSelectedEvent(event)
        setShowDetailModal(true)
    }

    const eventStyleGetter = (event) => {
        const classes = ['calendar-event', 'calendar-event--micro']

        const status = event.resource.status
        if (status === 'concluida') {
            classes.push('calendar-event--completed')
        } else if (status === 'em_execucao') {
            classes.push('calendar-event--in-progress')
        } else if (event.resource.deadline_at && new Date(event.resource.deadline_at) < new Date()) {
            classes.push('calendar-event--overdue')
        }

        return {
            className: classes.join(' '),
            style: event.style
        }
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
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-primary mb-2">Minha Agenda</h1>
                <p className="text-secondary">Visualize suas tarefas e prazos em tempo real</p>
            </div>

            <div className="card calendar-container bg-white">
                <BigCalendar
                    localizer={localizer}
                    events={events}
                    startAccessor="start"
                    endAccessor="end"
                    className="calendar-full-height min-h-[600px]"
                    onSelectEvent={handleSelectEvent}
                    eventPropGetter={eventStyleGetter}
                    views={['month', 'agenda']}
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
            {showDetailModal && selectedEvent && (
                <StaffTaskDetailModal
                    event={selectedEvent}
                    onClose={() => setShowDetailModal(false)}
                />
            )}
        </div>
    )
}

/**
 * Staff Task Detail Modal
 * Shows detailed information about a micro task
 * ZERO inline CSS - all styling via calendar.css
 */
function StaffTaskDetailModal({ event, onClose }) {
    const task = event.resource
    const deadlineDate = new Date(task.deadline_at)
    const isOverdue = deadlineDate < new Date() && task.status !== 'concluida'

    const getStatusText = (status) => {
        const statusMap = {
            'pendente': 'Pendente',
            'em_execucao': 'Em Execução',
            'concluida': 'Concluída',
            'bloqueada': 'Bloqueada',
            'devolvida': 'Devolvida'
        }
        return statusMap[status] || status
    }

    const getStatusClass = (status) => {
        if (status === 'concluida') return 'success'
        if (status === 'em_execucao') return 'primary'
        if (status === 'bloqueada') return 'warning'
        if (status === 'devolvida') return 'danger'
        return 'neutral'
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal task-detail-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h3>Detalhes da Tarefa</h3>
                    <button className="modal-close" onClick={onClose}>×</button>
                </div>

                <div className="modal-body">
                    <div className="task-detail-header">
                        <h2 className="task-detail-title">{task.funcao}</h2>

                        <CreatorSignature
                            name={task.tarefa?.created_by_name_snapshot}
                            createdAt={task.tarefa?.created_at}
                            compact
                        />

                        <div className="task-detail-metadata">
                            <span className="task-detail-badge task-detail-badge--micro">
                                ⚡ Minha Tarefa
                            </span>
                            <span className={`badge badge-${getStatusClass(task.status)}`}>
                                {task.status === 'concluida' && <CheckCircle size={12} />}
                                {getStatusText(task.status)}
                            </span>
                        </div>
                    </div>

                    {/* Deadline Section */}
                    <div className={`task-detail-deadline ${isOverdue ? 'task-detail-deadline--overdue' : ''}`}>
                        <Clock size={20} className="task-detail-deadline-icon" />
                        <div>
                            <div className="task-detail-deadline-text">
                                {isOverdue ? '🔴 ATRASADA - ' : ''}
                                Prazo: {deadlineDate.toLocaleDateString('pt-BR')} às {deadlineDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            {task.started_at && (
                                <div className="text-sm text-secondary mt-1">
                                    ✓ Iniciada em: {new Date(task.started_at).toLocaleDateString('pt-BR')} às {new Date(task.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                </div>
                            )}
                            {task.finished_at && (
                                <div className="text-sm text-success mt-1">
                                    ✓ Concluída em: {new Date(task.finished_at).toLocaleDateString('pt-BR')} às {new Date(task.finished_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Macro Task Reference */}
                    <div className="task-detail-section">
                        <div className="task-detail-section-title">Ordem de Serviço</div>
                        <div className="task-detail-section-content">
                            📋 {task.macroTaskTitle || task.tarefa?.titulo || 'N/A'}
                        </div>
                    </div>

                    {/* Weight */}
                    {task.peso && (
                        <div className="task-detail-section">
                            <div className="task-detail-section-title">Peso da Tarefa</div>
                            <div className="task-detail-section-content">{task.peso} pontos</div>
                        </div>
                    )}

                    {/* Created At */}
                    <div className="task-detail-section">
                        <div className="task-detail-section-title">Criado em</div>
                        <div className="task-detail-section-content">
                            {new Date(task.created_at).toLocaleDateString('pt-BR')} às {new Date(task.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    </div>
                </div>

                <div className="modal-footer task-detail-actions">
                    <button onClick={onClose} className="btn btn-secondary">
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    )
}

export default StaffCalendar
