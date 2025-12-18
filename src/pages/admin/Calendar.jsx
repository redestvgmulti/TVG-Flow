import { useState, useEffect, useMemo } from 'react'
import { Calendar as BigCalendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import ptBR from 'date-fns/locale/pt-BR'
import { supabase } from '../../services/supabase'
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
                    .select('id, titulo, deadline, status, priority, assigned_to, drive_link')
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

            return {
                id: task.id,
                title: task.titulo,
                start: deadline,
                end: deadline,
                allDay: true,
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
        return prof ? prof.nome : 'Unassigned'
    }

    function getStatusBadgeClass(status) {
        switch (status) {
            case 'completed':
                return 'badge-success'
            case 'in_progress':
                return 'badge-primary'
            case 'overdue':
                return 'badge-danger'
            default:
                return ''
        }
    }

    function getPriorityBadgeClass(priority) {
        switch (priority) {
            case 'urgent':
                return 'badge-danger'
            case 'high':
                return 'badge-warning'
            default:
                return ''
        }
    }

    const eventStyleGetter = (event) => {
        return {
            style: event.style
        }
    }

    if (loading) {
        return (
            <div>
                <h2>Calendário de Tarefas</h2>
                <div className="card loading-card">
                    <p className="loading-text-primary">Carregando calendário...</p>
                </div>
            </div>
        )
    }

    return (
        <div>
            <h2>Calendário de Tarefas</h2>

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
                        </div>
                        <div className="modal-body">
                            <div className="modal-detail-section">
                                <h4 className="modal-detail-title">{selectedTask.titulo}</h4>
                            </div>

                            <div className="modal-detail-rows">
                                <div>
                                    <strong>Status:</strong>{' '}
                                    <span className={`badge ${getStatusBadgeClass(selectedTask.status)}`}>
                                        {selectedTask.status}
                                    </span>
                                </div>

                                <div>
                                    <strong>Prioridade:</strong>{' '}
                                    <span className={`badge ${getPriorityBadgeClass(selectedTask.priority)}`}>
                                        {selectedTask.priority}
                                    </span>
                                </div>

                                <div>
                                    <strong>Prazo:</strong>{' '}
                                    {new Date(selectedTask.deadline).toLocaleString()}
                                </div>

                                <div>
                                    <strong>Atribuída a:</strong>{' '}
                                    {getAssignedToName(selectedTask.assigned_to)}
                                </div>

                                {selectedTask.drive_link && (
                                    <div>
                                        <strong>Arquivos:</strong>{' '}
                                        <a
                                            href={selectedTask.drive_link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="modal-detail-link"
                                        >
                                            📎 Abrir Link do Drive
                                        </a>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="modal-footer">
                            <button
                                onClick={() => setShowDetailModal(false)}
                                className="btn btn-primary"
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
