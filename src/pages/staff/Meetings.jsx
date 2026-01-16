import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, Clock, Info, Calendar as CalendarIcon, X } from 'lucide-react'
import { listMeetingsStaff, confirmPresence } from '../../services/meetingService'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from 'sonner'
import '../../styles/components.css'
import '../../styles/meetings.css'

export default function StaffMeetings() {
    const { user } = useAuth()
    const [meetings, setMeetings] = useState([])
    const [loading, setLoading] = useState(true)
    const [selectedMeeting, setSelectedMeeting] = useState(null)
    const [showDetailsModal, setShowDetailsModal] = useState(false)

    useEffect(() => {
        fetchMeetings()
    }, [])

    async function fetchMeetings() {
        try {
            const data = await listMeetingsStaff()
            setMeetings(data)
        } catch (error) {
            console.error('Error fetching meetings:', error)
        } finally {
            setLoading(false)
        }
    }

    function handleOpenDetails(meeting) {
        setSelectedMeeting(meeting)
        setShowDetailsModal(true)
    }

    async function handleConfirmPresence() {
        if (!selectedMeeting) return

        try {
            await confirmPresence(selectedMeeting.id)
            toast.success('Presença confirmada com sucesso')
            setShowDetailsModal(false)
            fetchMeetings() // Refresh to update status
        } catch (error) {
            console.error('Error confirming presence:', error)
            toast.error('Erro ao confirmar presença')
        }
    }

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleDateString('pt-BR')
    }

    const formatTime = (dateString) => {
        return new Date(dateString).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    }

    const getStatusBadge = (status) => {
        switch (status) {
            case 'agendada':
                return <span className="badge badge-primary">Agendada</span>
            case 'em_andamento':
                return <span className="badge badge-info text-white">Em Andamento</span>
            case 'realizada':
                return <span className="badge badge-success">Realizada</span>
            case 'cancelada':
                return <span className="badge badge-neutral">Cancelada</span>
            default:
                return <span className="badge badge-neutral">{status}</span>
        }
    }

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="loading"></div>
            </div>
        )
    }

    return (
        <div className="container">
            <div className="meetings-page-header">
                <div className="meetings-title">
                    <h1>Reuniões</h1>
                    <p>Reuniões presenciais agendadas para você</p>
                </div>
                <div>
                    <Link to="/staff/calendar" className="btn btn-secondary">
                        <Calendar size={18} />
                        Ver na agenda
                    </Link>
                </div>
            </div>

            {meetings.length === 0 ? (
                <div className="meetings-empty-state">
                    <div className="meetings-empty-icon">
                        <CalendarIcon size={48} strokeWidth={1} />
                    </div>
                    <h3 className="meetings-empty-title">Nenhuma reunião agendada</h3>
                    <p className="meetings-empty-desc">
                        Você não possui reuniões presenciais agendadas no momento.
                    </p>
                </div>
            ) : (
                <div className="task-list">
                    {meetings.map((meeting) => (
                        <div key={meeting.id} className="task-item">
                            <div className="task-item-content">
                                <div className="task-item-header">
                                    <h3 className="task-item-title">{meeting.titulo}</h3>
                                </div>

                                <div className="meeting-card-meta">
                                    <span className="meeting-date flex items-center gap-1">
                                        <CalendarIcon size={14} />
                                        {formatDate(meeting.data_inicio)}
                                    </span>
                                    <span className="meeting-meta-separator">•</span>
                                    <span className="meeting-time flex items-center gap-1">
                                        <Clock size={14} />
                                        {formatTime(meeting.data_inicio)} – {formatTime(meeting.data_fim)}
                                    </span>
                                    <span className="meeting-meta-separator">•</span>
                                    {getStatusBadge(meeting.status)}
                                </div>
                            </div>

                            <div className="task-item-actions">
                                <button
                                    className="btn btn-sm btn-ghost"
                                    onClick={() => handleOpenDetails(meeting)}
                                >
                                    <Info size={16} />
                                    Ver detalhes
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Details Modal */}
            {showDetailsModal && selectedMeeting && (
                <div className="modal-overlay">
                    <div className="modal">
                        <div className="modal-header">
                            <h2 className="modal-title">Detalhes da Reunião</h2>
                            <button
                                className="btn-icon"
                                onClick={() => setShowDetailsModal(false)}
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-content">
                            <div className="form-group">
                                <label>Título</label>
                                <div className="p-3 bg-base-200 rounded-lg">{selectedMeeting.titulo}</div>
                            </div>

                            <div className="form-group">
                                <label>Descrição</label>
                                <div className="p-3 bg-base-200 rounded-lg min-h-[60px]">
                                    {selectedMeeting.descricao || 'Sem descrição'}
                                </div>
                            </div>

                            <div className="form-row-group">
                                <div className="form-group">
                                    <label>Data</label>
                                    <div className="p-3 bg-base-200 rounded-lg">
                                        {formatDate(selectedMeeting.data_inicio)}
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>Início</label>
                                    <div className="p-3 bg-base-200 rounded-lg">
                                        {formatTime(selectedMeeting.data_inicio)}
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label>Fim</label>
                                    <div className="p-3 bg-base-200 rounded-lg">
                                        {formatTime(selectedMeeting.data_fim)}
                                    </div>
                                </div>
                            </div>

                            <div className="form-group mt-4">
                                <label>Status</label>
                                <div>{getStatusBadge(selectedMeeting.status)}</div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowDetailsModal(false)}
                            >
                                Fechar
                            </button>
                            {selectedMeeting &&
                                (selectedMeeting.status === 'agendada' || selectedMeeting.status === 'em_andamento') &&
                                selectedMeeting.reunioes_participantes?.find(p => p.profissional_id === user?.id && !p.participou) && (
                                    <button
                                        className="btn btn-primary"
                                        onClick={handleConfirmPresence}
                                    >
                                        Confirmar Presença
                                    </button>
                                )}
                            {selectedMeeting &&
                                selectedMeeting.reunioes_participantes?.find(p => p.profissional_id === user?.id && p.participou) && (
                                    <span className="text-sm font-semibold text-green-600 self-center mr-4">
                                        Presença Confirmada
                                    </span>
                                )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
