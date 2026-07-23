import { useState, useEffect } from 'react'
import { Calendar as BigCalendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import ptBR from 'date-fns/locale/pt-BR'
import { fetchAdminCalendarEvents, getEventClasses } from '../../services/calendarService'
import { Calendar as CalendarIcon, Clock, User, ExternalLink, AlertCircle, CheckCircle } from 'lucide-react'
import { SkeletonTable } from '../../components/Skeleton'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import '../../styles/calendar.css'

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
    const [events, setEvents] = useState([])
    const [loading, setLoading] = useState(true)
    const [selectedEvent, setSelectedEvent] = useState(null)
    const [showDetailModal, setShowDetailModal] = useState(false)
    const [view, setView] = useState('month')
    const [date, setDate] = useState(new Date())

    useEffect(() => {
        fetchData()
    }, [])

    async function fetchData() {
        try {
            setLoading(true)
            const calendarEvents = await fetchAdminCalendarEvents()
            setEvents(calendarEvents)
        } catch (error) {
            console.error('Error fetching calendar data:', error)
        } finally {
            setLoading(false)
        }
    }

    function handleSelectEvent(event) {
        setSelectedEvent(event)
        setShowDetailModal(true)
    }

    const eventStyleGetter = (event) => {
        return {
            className: getEventClasses(event),
            style: event.style
        }
    }

    if (loading) {
        return (
            <div className="animation-fade-in">
                <div className="dashboard-header">
                    <h2>Agenda</h2>
                </div>
                <div className="card">
                    <SkeletonTable />
                </div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in">
            <div className="dashboard-header calendar-page-header">
                <h2>Agenda</h2>
                <div className="calendar-legend">
                    <span className="calendar-legend-item"><i className="calendar-legend-dot calendar-legend-dot--normal" /> No prazo</span>
                    <span className="calendar-legend-item"><i className="calendar-legend-dot calendar-legend-dot--attention" /> Vence em breve</span>
                    <span className="calendar-legend-item"><i className="calendar-legend-dot calendar-legend-dot--overdue" /> Atrasada</span>
                    <span className="calendar-legend-item"><i className="calendar-legend-dot calendar-legend-dot--completed" /> Concluída</span>
                </div>
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
                <TaskDetailModal
                    event={selectedEvent}
                    onClose={() => setShowDetailModal(false)}
                />
            )}
        </div>
    )
}

/**
 * Task Detail Modal Component
 * Shows detailed information about a calendar event (macro or micro task)
 * ZERO inline CSS - all styling via calendar.css
 */
function TaskDetailModal({ event, onClose }) {
    const task = event.resource
    const isMacro = event.eventType === 'macro'
    const deadlineDate = isMacro ? new Date(task.deadline) : new Date(task.deadline_at)
    const isOverdue = deadlineDate < new Date() && task.status !== 'completed' && task.status !== 'concluida'

    // Status display
    const getStatusText = (status) => {
        const statusMap = {
            'pending': 'Pendente',
            'pendente': 'Pendente',
            'in_progress': 'Em Andamento',
            'em_execucao': 'Em Execução',
            'completed': 'Concluída',
            'concluida': 'Concluída',
            'bloqueada': 'Bloqueada',
            'devolvida': 'Devolvida'
        }
        return statusMap[status] || status
    }

    const getStatusClass = (status) => {
        if (status === 'completed' || status === 'concluida') return 'success'
        if (status === 'in_progress' || status === 'em_execucao') return 'primary'
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
                        <h2 className="task-detail-title">
                            {isMacro ? task.titulo : task.funcao}
                        </h2>

                        <div className="task-detail-metadata">
                            <span className={`task-detail-badge task-detail-badge--${isMacro ? 'macro' : 'micro'}`}>
                                {isMacro ? 'Tarefa Macro' : 'Tarefa Micro'}
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
                                {isOverdue ? 'Atrasada — ' : ''}
                                Prazo: {deadlineDate.toLocaleDateString('pt-BR')} às {deadlineDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            {task.started_at && (
                                <div className="text-sm text-secondary mt-1">
                                    Iniciada em: {new Date(task.started_at).toLocaleDateString('pt-BR')}
                                </div>
                            )}
                            {task.finished_at && (
                                <div className="text-sm text-success mt-1">
                                    Concluída em: {new Date(task.finished_at).toLocaleDateString('pt-BR')}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Description */}
                    {task.descricao && (
                        <div className="task-detail-section">
                            <div className="task-detail-section-title">Descrição</div>
                            <div className="task-detail-section-content">{task.descricao}</div>
                        </div>
                    )}

                    {/* Macro task specific info */}
                    {isMacro && (
                        <>
                            {task.empresa && (
                                <div className="task-detail-section">
                                    <div className="task-detail-section-title">Empresa</div>
                                    <div className="task-detail-section-content">{task.empresa.nome}</div>
                                </div>
                            )}

                            {task.assigned_to && (
                                <div className="task-detail-section">
                                    <div className="task-detail-section-title">Responsável Principal</div>
                                    <div className="task-detail-responsible-list">
                                        <div className="task-detail-responsible-item">
                                            <div className="task-detail-avatar">
                                                {task.assigned_to.nome?.charAt(0) || '?'}
                                            </div>
                                            <span>{task.assigned_to.nome}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {typeof task.progress !== 'undefined' && (
                                <div className="task-detail-section">
                                    <div className="task-detail-section-title">Progresso</div>
                                    <div className="task-detail-section-content">
                                        <div className="progress-bar">
                                            <div className="progress-fill" style={{ width: `${task.progress}%` }}></div>
                                        </div>
                                        <span className="text-sm text-secondary">{task.progress}% completo</span>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Micro task specific info */}
                    {!isMacro && (
                        <>
                            <div className="task-detail-section">
                                <div className="task-detail-section-title">Tarefa Macro</div>
                                <div className="task-detail-section-content">
                                    {task.macroTaskTitle || task.tarefa?.titulo || 'N/A'}
                                </div>
                            </div>

                            {task.profissional && (
                                <div className="task-detail-section">
                                    <div className="task-detail-section-title">Profissional Responsável</div>
                                    <div className="task-detail-responsible-list">
                                        <div className="task-detail-responsible-item">
                                            <div className="task-detail-avatar">
                                                {task.profissional.nome?.charAt(0) || '?'}
                                            </div>
                                            <span>{task.profissional.nome}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {task.peso && (
                                <div className="task-detail-section">
                                    <div className="task-detail-section-title">Peso</div>
                                    <div className="task-detail-section-content">{task.peso}</div>
                                </div>
                            )}
                        </>
                    )}

                    {/* Drive Link */}
                    {task.drive_link && (
                        <div className="task-detail-section">
                            <div className="task-detail-section-title">Arquivos</div>
                            <a
                                href={task.drive_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary flex items-center gap-2 hover:underline"
                            >
                                <ExternalLink size={16} />
                                Acessar Arquivos no Drive
                            </a>
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

export default Calendar
