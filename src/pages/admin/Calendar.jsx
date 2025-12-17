import { useState, useEffect, useMemo } from 'react'
import { Calendar as BigCalendar, dateFnsLocalizer } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { supabase } from '../../services/supabase'
import 'react-big-calendar/lib/css/react-big-calendar.css'

const locales = {
    'en-US': require('date-fns/locale/en-US')
}

const localizer = dateFnsLocalizer({
    format,
    parse,
    startOfWeek,
    getDay,
    locales,
})

function Calendar() {
    const [tasks, setTasks] = useState([])
    const [professionals, setProfessionals] = useState([])
    const [loading, setLoading] = useState(true)
    const [selectedTask, setSelectedTask] = useState(null)
    const [showDetailModal, setShowDetailModal] = useState(false)

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
                <h2>Task Calendar</h2>
                <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <p style={{ color: 'var(--color-text-secondary)' }}>Loading calendar...</p>
                </div>
            </div>
        )
    }

    return (
        <div>
            <h2>Task Calendar</h2>

            <div className="card" style={{ padding: 'var(--space-lg)', minHeight: '600px' }}>
                <BigCalendar
                    localizer={localizer}
                    events={events}
                    startAccessor="start"
                    endAccessor="end"
                    style={{ height: '100%', minHeight: '550px' }}
                    onSelectEvent={handleSelectEvent}
                    eventPropGetter={eventStyleGetter}
                    views={['month', 'week', 'agenda']}
                    defaultView="month"
                />
            </div>

            {/* Task Detail Modal */}
            {showDetailModal && selectedTask && (
                <div className="modal-backdrop" onClick={() => setShowDetailModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Task Details</h3>
                        </div>
                        <div className="modal-body">
                            <div style={{ marginBottom: 'var(--space-md)' }}>
                                <h4 style={{ marginBottom: 'var(--space-xs)' }}>{selectedTask.titulo}</h4>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                                <div>
                                    <strong>Status:</strong>{' '}
                                    <span className={`badge ${getStatusBadgeClass(selectedTask.status)}`}>
                                        {selectedTask.status}
                                    </span>
                                </div>

                                <div>
                                    <strong>Priority:</strong>{' '}
                                    <span className={`badge ${getPriorityBadgeClass(selectedTask.priority)}`}>
                                        {selectedTask.priority}
                                    </span>
                                </div>

                                <div>
                                    <strong>Deadline:</strong>{' '}
                                    {new Date(selectedTask.deadline).toLocaleString()}
                                </div>

                                <div>
                                    <strong>Assigned To:</strong>{' '}
                                    {getAssignedToName(selectedTask.assigned_to)}
                                </div>

                                {selectedTask.drive_link && (
                                    <div>
                                        <strong>Files:</strong>{' '}
                                        <a
                                            href={selectedTask.drive_link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
                                        >
                                            📎 Open Drive Link
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
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Calendar
