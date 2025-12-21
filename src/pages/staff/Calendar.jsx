import { useState, useEffect, useMemo } from 'react'
import { Calendar as BigCalendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import ptBR from 'date-fns/locale/pt-BR'
import { supabase } from '../../services/supabase'
import { Calendar as CalendarIcon, Clock, ExternalLink, AlertCircle, CheckCircle, User } from 'lucide-react'
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

function StaffCalendar() {
    const [tasks, setTasks] = useState([])
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
            // RLS automatically filters
            const { data, error } = await supabase
                .from('tarefas')
                .select('id, titulo, deadline, status, priority, drive_link, created_at, descricao')
                .order('deadline')

            if (error) throw error
            setTasks(data || [])
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
            } else if (task.priority === 'urgent') {
                color = '#ff9500' // orange
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

    const eventStyleGetter = (event) => {
        return {
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
                <p className="text-secondary">Visualize seus prazos e entregas.</p>
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
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-semibold text-tertiary uppercase tracking-wide">Título</label>
                                    <p className="text-lg font-medium text-primary mt-1">{selectedTask.titulo}</p>
                                </div>

                                <div>
                                    <label className="text-xs font-semibold text-tertiary uppercase tracking-wide">Descrição</label>
                                    <p className="text-sm text-secondary mt-1 whitespace-pre-wrap leading-relaxed">
                                        {selectedTask.descricao || 'Sem descrição'}
                                    </p>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-semibold text-tertiary uppercase tracking-wide mb-1 block">Status</label>
                                        <span className={`badge badge-${selectedTask.status === 'completed' ? 'success' : selectedTask.status === 'in_progress' ? 'primary' : 'neutral'} inline-flex items-center gap-1`}>
                                            {selectedTask.status === 'completed' && <CheckCircle size={12} />}
                                            {selectedTask.status === 'completed' ? 'Concluída' : selectedTask.status === 'in_progress' ? 'Em Andamento' : 'Pendente'}
                                        </span>
                                    </div>

                                    <div>
                                        <label className="text-xs font-semibold text-tertiary uppercase tracking-wide mb-1 block">Prioridade</label>
                                        <span className={`badge badge-${selectedTask.priority === 'urgent' ? 'danger' : selectedTask.priority === 'high' ? 'warning' : 'neutral'} inline-flex items-center gap-1`}>
                                            {selectedTask.priority === 'urgent' && <AlertCircle size={12} />}
                                            {selectedTask.priority === 'urgent' ? 'Urgente' : selectedTask.priority === 'high' ? 'Alta' : 'Normal'}
                                        </span>
                                    </div>
                                </div>

                                {selectedTask.drive_link && (
                                    <div className="pt-2">
                                        <a
                                            href={selectedTask.drive_link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-brand flex items-center gap-2 hover:underline font-medium text-sm"
                                        >
                                            <ExternalLink size={16} />
                                            Acessar Arquivos
                                        </a>
                                    </div>
                                )}

                                <div className="bg-subtle p-3 rounded-lg flex flex-col gap-2 mt-2">
                                    <div className="flex items-center gap-2 text-sm text-secondary">
                                        <CalendarIcon size={14} className="text-tertiary" />
                                        <span>Criado em: <strong>{new Date(selectedTask.created_at || new Date()).toLocaleDateString()}</strong></span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm text-secondary">
                                        <Clock size={14} className="text-tertiary" />
                                        <span>Vencimento: <strong className="text-brand">{new Date(selectedTask.deadline).toLocaleDateString()}</strong></span>
                                    </div>
                                </div>
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

export default StaffCalendar
