import { useState, useEffect } from 'react'
import { Users, Plus, Edit2, Trash2, X, Calendar as CalendarIcon, Clock, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import {
    createMeeting,
    listMeetingsAdmin,
    updateMeeting,
    cancelMeeting,
    getAvailableStaff,
    validateMeetingData
} from '../../services/meetingService'
import { useAuth } from '../../contexts/AuthContext'
import { SkeletonList } from '../../components/Skeleton'
import '../../styles/components.css'
import '../../styles/meetings.css'

function Meetings() {
    const [meetings, setMeetings] = useState([])
    const [loading, setLoading] = useState(true)
    const [staff, setStaff] = useState([])
    const { user } = useAuth()

    // Modals
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [showEditModal, setShowEditModal] = useState(false)
    const [showCancelConfirmation, setShowCancelConfirmation] = useState(false) // ✅ NEW
    const [selectedMeeting, setSelectedMeeting] = useState(null)
    const [submitting, setSubmitting] = useState(false)

    // Form state
    const [formData, setFormData] = useState({
        titulo: '',
        descricao: '',
        data: '',
        hora_inicio: '',
        hora_fim: '',
        participant_ids: []
    })

    useEffect(() => {
        fetchData()
    }, [])

    async function fetchData() {
        try {
            setLoading(true)
            const [meetingsData, staffData] = await Promise.all([
                listMeetingsAdmin(),
                getAvailableStaff()
            ])
            setMeetings(meetingsData)
            setStaff(staffData)
        } catch (error) {
            console.error('[Meetings] Error fetching data:', error)
            toast.error('Erro ao carregar reuniões')
        } finally {
            setLoading(false)
        }
    }

    function resetForm() {
        setFormData({
            titulo: '',
            descricao: '',
            data: '',
            hora_inicio: '',
            hora_fim: '',
            participant_ids: []
        })
    }

    function handleOpenCreateModal() {
        resetForm()
        setShowCreateModal(true)
    }

    function handleOpenEditModal(meeting) {
        setSelectedMeeting(meeting)

        // Parse ISO datetime to date and time
        const startDate = new Date(meeting.data_inicio)
        const endDate = new Date(meeting.data_fim)

        // Generate YYYY-MM-DD in Local Time
        const year = startDate.getFullYear()
        const month = String(startDate.getMonth() + 1).padStart(2, '0')
        const day = String(startDate.getDate()).padStart(2, '0')
        const dateStr = `${year}-${month}-${day}`

        // Generate HH:MM in Local Time manually to ensure "HH:MM" format for input
        const formatTimeInput = (date) => {
            const h = String(date.getHours()).padStart(2, '0')
            const m = String(date.getMinutes()).padStart(2, '0')
            return `${h}:${m}`
        }

        const startTimeStr = formatTimeInput(startDate)
        const endTimeStr = formatTimeInput(endDate)

        // Extract participant IDs
        const participantIds = meeting.reunioes_participantes?.map(p => p.profissional_id) || []

        setFormData({
            titulo: meeting.titulo || '',
            descricao: meeting.descricao || '',
            data: dateStr,
            hora_inicio: startTimeStr,
            hora_fim: endTimeStr,
            participant_ids: participantIds
        })
        setShowEditModal(true)
    }



    async function handleSubmit(e) {
        e.preventDefault()

        // Create Date objects from Local Time (Browser Timezone) to ensure correct UTC conversion
        const [year, month, day] = formData.data.split('-').map(Number)
        const [startHour, startMin] = formData.hora_inicio.split(':').map(Number)
        const [endHour, endMin] = formData.hora_fim.split(':').map(Number)

        const startDateTime = new Date(year, month - 1, day, startHour, startMin)
        const endDateTime = new Date(year, month - 1, day, endHour, endMin)

        const payload = {
            titulo: formData.titulo,
            descricao: formData.descricao,
            data_inicio: startDateTime.toISOString(),
            data_fim: endDateTime.toISOString(),
            participant_ids: formData.participant_ids
        }

        const validation = validateMeetingData(payload)
        if (!validation.isValid) {
            const firstError = Object.values(validation.errors)[0]
            toast.error(firstError)
            return
        }

        setSubmitting(true)

        try {
            if (selectedMeeting) {
                await updateMeeting(selectedMeeting.id, {
                    titulo: payload.titulo,
                    descricao: payload.descricao,
                    data_inicio: payload.data_inicio,
                    data_fim: payload.data_fim,
                    participant_ids: payload.participant_ids
                })
                toast.success('Reunião atualizada com sucesso!')
                setShowEditModal(false)
            } else {
                await createMeeting(payload)
                toast.success('Reunião criada com sucesso!')
                setShowCreateModal(false)
            }

            setSelectedMeeting(null)
            resetForm()
            await fetchData()
        } catch (error) {
            console.error('[Meetings] Error saving meeting:', error)
            toast.error('Erro ao salvar reunião')
        } finally {
            setSubmitting(false)
        }
    }


    // ✅ TRIGGER MODAL
    function handleCancelClick() {
        if (!selectedMeeting) return
        setShowCancelConfirmation(true)
    }

    // ✅ EXECUTE CANCELLATION
    async function handleConfirmCancel() {
        if (!selectedMeeting) return

        setSubmitting(true)
        try {
            await cancelMeeting(selectedMeeting.id)
            toast.success('Reunião cancelada com sucesso')

            // Close all modals
            setShowCancelConfirmation(false)
            setShowEditModal(false)

            setSelectedMeeting(null)
            await fetchData()
        } catch (error) {
            console.error('[Meetings] Error canceling meeting:', error)
            toast.error('Erro ao cancelar reunião')
        } finally {
            setSubmitting(false)
        }
    }

    function handleParticipantToggle(profissionalId) {
        setFormData(prev => ({
            ...prev,
            participant_ids: prev.participant_ids.includes(profissionalId)
                ? prev.participant_ids.filter(id => id !== profissionalId)
                : [...prev.participant_ids, profissionalId]
        }))
    }

    function formatDate(isoString) {
        if (!isoString) return ''
        return new Date(isoString).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        })
    }

    function formatTime(isoString) {
        if (!isoString) return ''
        return new Date(isoString).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    function getStatusBadge(status) {
        switch (status) {
            case 'agendada':
                return <span className="ap-chip tone-brand">Agendada</span>
            case 'em_andamento':
                return <span className="ap-chip tone-warn">Em Andamento</span>
            case 'realizada':
                return <span className="ap-chip tone-success">Realizada</span>
            case 'cancelada':
                return <span className="ap-chip tone-neutral">Cancelada</span>
            default:
                return <span className="ap-chip tone-neutral">{status}</span>
        }
    }

    if (loading) {
        return (
            <div className="page-container">
                <div className="meetings-page-header">
                    <div className="meetings-title">
                        <h1>Reuniões</h1>
                        <p>Gerencie reuniões presenciais da equipe</p>
                    </div>
                </div>
                <SkeletonList count={4} />
            </div>
        )
    }

    return (
        <div className="page-container">
            {/* Header */}
            <div className="meetings-page-header">
                <div className="meetings-title">
                    <h1>Reuniões</h1>
                    <p>Gerencie reuniões presenciais da equipe</p>
                </div>
                <button className="btn btn-primary" onClick={handleOpenCreateModal}>
                    <Plus size={18} />
                    Nova Reunião
                </button>
            </div>

            {/* Content */}
            {meetings.length === 0 ? (
                <div className="meetings-empty-state">
                    <div className="meetings-empty-icon">
                        <CalendarIcon size={48} strokeWidth={1.5} />
                    </div>
                    <h3 className="meetings-empty-title">Nenhuma reunião agendada</h3>
                    <p className="meetings-empty-desc">
                        Crie uma reunião para organizar encontros presenciais com sua equipe.
                    </p>
                    <button className="btn btn-primary" onClick={handleOpenCreateModal}>
                        Criar reunião
                    </button>
                </div>
            ) : (
                <div className="task-list">
                    {meetings.map((meeting) => (
                        <div key={meeting.id} className="task-item">
                            <div className="task-item-content">
                                <h3 className="task-item-title">{meeting.titulo}</h3>

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
                                <span className="text-secondary text-sm flex items-center gap-1">
                                    <Users size={14} />
                                    {meeting.reunioes_participantes?.length || 0} participantes
                                </span>

                                <div className="btn-group">
                                    <button
                                        className="btn btn-ghost"
                                        onClick={() => handleOpenEditModal(meeting)}
                                        title="Editar"
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create/Edit Modal */}
            {(showCreateModal || showEditModal) && (
                <div className="modal-backdrop" onClick={() => {
                    if (!submitting && !showCancelConfirmation) {
                        setShowCreateModal(false)
                        setShowEditModal(false)
                        setSelectedMeeting(null)
                    }
                }}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{selectedMeeting ? 'Editar Reunião' : 'Nova Reunião'}</h3>
                            <button
                                className="modal-close"
                                onClick={() => {
                                    setShowCreateModal(false)
                                    setShowEditModal(false)
                                    setSelectedMeeting(null)
                                }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Título</label>
                                    <input
                                        type="text"
                                        className="input"
                                        value={formData.titulo}
                                        onChange={(e) => setFormData({ ...formData, titulo: e.target.value })}
                                        placeholder="Ex: Planejamento Q1"
                                        autoFocus
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Descrição (opcional)</label>
                                    <textarea
                                        className="input"
                                        value={formData.descricao}
                                        onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                                        placeholder="Detalhes da pauta..."
                                        rows={2}
                                    />
                                </div>

                                <div className="form-row-group">
                                    <div className="form-group">
                                        <label>Data</label>
                                        <input
                                            type="date"
                                            className="input"
                                            value={formData.data}
                                            onChange={(e) => {
                                                // Prevent years with more than 4 digits
                                                if (e.target.value.length <= 10) {
                                                    setFormData({ ...formData, data: e.target.value })
                                                }
                                            }}
                                            max="2099-12-31"
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Início</label>
                                        <input
                                            type="time"
                                            className="input"
                                            value={formData.hora_inicio}
                                            onChange={(e) => setFormData({ ...formData, hora_inicio: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Fim</label>
                                        <input
                                            type="time"
                                            className="input"
                                            value={formData.hora_fim}
                                            onChange={(e) => setFormData({ ...formData, hora_fim: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>
                                        Participantes
                                        <span style={{ fontWeight: 400, marginLeft: '8px', color: 'var(--color-text-tertiary)' }}>
                                            ({formData.participant_ids.length} selecionado{formData.participant_ids.length !== 1 ? 's' : ''})
                                        </span>
                                    </label>
                                    <div className="participants-list-container">
                                        {staff.length === 0 ? (
                                            <p style={{ padding: '8px', color: 'var(--color-text-tertiary)' }}>Nenhum profissional disponível</p>
                                        ) : (
                                            staff.map(professional => {
                                                const isParticipant = formData.participant_ids.includes(professional.id)
                                                // Find status if editing
                                                const participantRecord = selectedMeeting?.reunioes_participantes?.find(p => p.profissional_id === professional.id)
                                                const hasParticipated = participantRecord?.participou

                                                return (
                                                    <label key={professional.id} className="participant-option">
                                                        <input
                                                            type="checkbox"
                                                            className="participant-checkbox"
                                                            checked={isParticipant}
                                                            onChange={() => handleParticipantToggle(professional.id)}
                                                        />
                                                        <span className="participant-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                                            {professional.nome}
                                                            {selectedMeeting && isParticipant && (
                                                                <span className={`ap-chip no-dot ${hasParticipated ? 'tone-success' : 'tone-neutral'}`}>
                                                                    {hasParticipated ? 'Presente' : 'Pendente'}
                                                                </span>
                                                            )}
                                                        </span>
                                                    </label>
                                                )
                                            })
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="modal-footer flex justify-between items-center w-full">
                                <div>
                                    {selectedMeeting && selectedMeeting.criada_por === user?.id && (selectedMeeting.status === 'agendada' || selectedMeeting.status === 'em_andamento') && (
                                        <button
                                            type="button"
                                            className="btn btn-ghost"
                                            style={{ color: 'var(--color-danger)' }}
                                            onClick={handleCancelClick}
                                            disabled={submitting}
                                        >
                                            Cancelar Reunião
                                        </button>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        onClick={() => {
                                            setShowCreateModal(false)
                                            setShowEditModal(false)
                                        }}
                                        disabled={submitting}
                                    >
                                        Fechar
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        disabled={submitting || (selectedMeeting && (selectedMeeting.status === 'realizada' || selectedMeeting.status === 'cancelada'))}
                                    >
                                        {submitting ? 'Salvando...' : 'Salvar'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ✅ CONFIRMATION MODAL */}
            {showCancelConfirmation && (
                <div className="modal-backdrop" style={{ zIndex: 1100 }}>
                    <div className="modal" style={{ maxWidth: '400px', height: 'auto' }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-body" style={{ textAlign: 'center', padding: '24px' }}>
                            <div className="admin-tasks-delete-modal-icon">
                                <AlertTriangle size={24} />
                            </div>
                            <h3 className="admin-tasks-delete-modal-title">
                                Cancelar Reunião
                            </h3>
                            <p className="admin-tasks-delete-modal-message" style={{ marginBottom: '24px' }}>
                                Tem certeza que deseja cancelar esta reunião? Os participantes serão notificados automaticamente.
                            </p>
                            <div className="flex gap-3 justify-center" style={{ justifyContent: 'center' }}>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowCancelConfirmation(false)}
                                    disabled={submitting}
                                >
                                    Voltar
                                </button>
                                <button
                                    className="btn btn-danger"
                                    onClick={handleConfirmCancel}
                                    disabled={submitting}
                                >
                                    {submitting ? 'Cancelando...' : 'Cancelar Reunião'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Meetings
