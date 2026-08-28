import { useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import Modal from '../ui/Modal'

export default function ApproveCollectedNewsModal({ item, isOpen, isSubmitting, onClose, onConfirm }) {
    const [observation, setObservation] = useState('')

    function close() {
        if (!isSubmitting) onClose()
    }

    function submit(event) {
        event.preventDefault()
        onConfirm(observation.trim() || null)
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={close}
            title="Aprovar pauta"
            subtitle="Ela ficará disponível no Banco de pautas para a equipe pegar."
            icon={CheckCircle2}
            iconColor="#0f766e"
            iconBg="#d1fae5"
            closeOnBackdrop={!isSubmitting}
            footer={(
                <>
                    <button type="button" className="btn btn-secondary" onClick={close} disabled={isSubmitting}>
                        Cancelar
                    </button>
                    <button type="submit" form="approve-collected-news-form" className="btn btn-primary" disabled={isSubmitting}>
                        {isSubmitting ? 'Aprovando...' : 'Aprovar e enviar ao banco'}
                    </button>
                </>
            )}
        >
            <form id="approve-collected-news-form" onSubmit={submit}>
                <p style={{ margin: '0 0 20px', color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
                    <strong style={{ color: 'var(--color-text-primary)' }}>{item?.title}</strong>
                </p>
                <div className="input-group">
                    <label htmlFor="collected-news-observation">Orientação para quem for produzir <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>(opcional)</span></label>
                    <textarea
                        id="collected-news-observation"
                        className="input"
                        value={observation}
                        onChange={(event) => setObservation(event.target.value)}
                        placeholder="Ex.: destaque a informação principal ou use um tom mais direto."
                        rows={4}
                        disabled={isSubmitting}
                    />
                    <small style={{ color: 'var(--color-text-tertiary)', lineHeight: 1.45 }}>
                        Essa orientação aparecerá junto da matéria no Banco de pautas.
                    </small>
                </div>
            </form>
        </Modal>
    )
}
