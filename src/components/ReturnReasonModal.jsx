import { useState } from 'react'
import { AlertCircle } from 'lucide-react'
import Modal from './ui/Modal'

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
        <Modal
            isOpen
            onClose={onClose}
            title="Solicitar Ajuste"
            closeOnBackdrop={!submitting}
            footer={(
                <>
                    <button type="button" onClick={onClose} className="btn btn-secondary" disabled={submitting}>
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        form="return-reason-form"
                        className="btn btn-primary"
                        disabled={submitting || !targetProfessionalId || motivo.trim().length < 10}
                    >
                        {submitting ? 'Devolvendo...' : 'Devolver Etapa'}
                    </button>
                </>
            )}
        >
            <div className="info-banner">
                <AlertCircle size={16} />
                <p>Esta etapa será devolvida para outro profissional revisar. O motivo é obrigatório para rastreabilidade.</p>
            </div>

            <form id="return-reason-form" onSubmit={handleSubmit}>
                <div className="input-group">
                    <label>Devolver para *</label>
                    <select
                        className="input"
                        value={targetProfessionalId}
                        onChange={(e) => setTargetProfessionalId(e.target.value)}
                        required
                        disabled={professionals.length === 0}
                    >
                        <option value="">
                            {professionals.length === 0
                                ? 'Nenhum outro profissional nesta tarefa'
                                : 'Selecione o profissional...'}
                        </option>
                        {professionals.map(p => (
                            <option key={p.profissional_id} value={p.profissional_id}>
                                {p.ordem != null ? `#${p.ordem} - ` : ''}{p.profissionais.nome} ({p.funcao})
                            </option>
                        ))}
                    </select>
                </div>

                <div className="input-group">
                    <label>Motivo da Devolução *</label>
                    <textarea
                        className="input"
                        placeholder="Descreva o motivo do ajuste solicitado..."
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        rows={4}
                        required
                        minLength={10}
                    />
                    <span style={{
                        display: 'block',
                        marginTop: '6px',
                        fontSize: '12px',
                        color: motivo.trim().length < 10 ? 'var(--color-danger)' : 'var(--color-text-tertiary)'
                    }}>
                        {motivo.trim().length}/10 caracteres mínimos
                    </span>
                </div>
            </form>
        </Modal>
    )
}
