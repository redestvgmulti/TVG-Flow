import { useState } from 'react'
import { X, AlertCircle } from 'lucide-react'
import '../styles/modal.css'

export default function ReturnReasonModal({ microTask, professionals, onClose, onSubmit }) {
    const [targetProfessionalId, setTargetProfessionalId] = useState('')
    const [motivo, setMotivo] = useState('')
    const [submitting, setSubmitting] = useState(false)

    async function handleSubmit(e) {
        e.preventDefault()

        if (!targetProfessionalId || !motivo.trim()) {
            return
        }

        setSubmitting(true)
        try {
            await onSubmit({
                micro_task_id: microTask.id,
                to_profissional_id: targetProfessionalId,
                motivo: motivo.trim()
            })
            onClose()
        } catch (error) {
            console.error('Error returning task:', error)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-container" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">Solicitar Ajuste</h2>
                    <button onClick={onClose} className="modal-close-btn">
                        <X size={20} />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="modal-info-box">
                        <AlertCircle size={16} />
                        <p>Esta etapa será devolvida para outro profissional revisar. O motivo é obrigatório para rastreabilidade.</p>
                    </div>

                    <form onSubmit={handleSubmit} className="modal-form">
                        <div className="modal-form-group">
                            <label className="modal-form-label">
                                Devolver para *
                            </label>
                            <select
                                className="modal-form-select"
                                value={targetProfessionalId}
                                onChange={(e) => setTargetProfessionalId(e.target.value)}
                                required
                            >
                                <option value="">Selecione o profissional...</option>
                                {professionals
                                    .filter(p => p.funcao === microTask.funcao)
                                    .map(p => (
                                        <option key={p.profissional_id} value={p.profissional_id}>
                                            {p.profissionais.nome}
                                        </option>
                                    ))}
                            </select>
                        </div>

                        <div className="modal-form-group">
                            <label className="modal-form-label">
                                Motivo da Devolução *
                            </label>
                            <textarea
                                className="modal-form-textarea"
                                placeholder="Descreva o motivo do ajuste solicitado..."
                                value={motivo}
                                onChange={(e) => setMotivo(e.target.value)}
                                rows={4}
                                required
                                minLength={10}
                            />
                            <span className="modal-form-hint">
                                Mínimo 10 caracteres
                            </span>
                        </div>

                        <div className="modal-actions">
                            <button
                                type="button"
                                onClick={onClose}
                                className="modal-btn-cancel"
                                disabled={submitting}
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                className="modal-btn-submit"
                                disabled={submitting || !targetProfessionalId || motivo.trim().length < 10}
                            >
                                {submitting ? 'Devolvendo...' : 'Devolver Etapa'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    )
}
