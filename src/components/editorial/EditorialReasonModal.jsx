import { useState } from 'react'
import { MessageSquareText } from 'lucide-react'
import Modal from '../ui/Modal'

export default function EditorialReasonModal({
    isOpen,
    isSubmitting,
    onClose,
    onConfirm,
    title,
    subtitle,
    itemTitle,
    label,
    placeholder,
    confirmLabel,
    danger = false,
}) {
    const [reason, setReason] = useState('')

    function close() {
        if (!isSubmitting) onClose()
    }

    function submit(event) {
        event.preventDefault()
        onConfirm(reason.trim() || null)
    }

    return (
        <Modal
            isOpen={isOpen}
            onClose={close}
            title={title}
            subtitle={subtitle}
            icon={MessageSquareText}
            iconColor={danger ? '#b42318' : '#1d4ed8'}
            iconBg={danger ? '#fee4e2' : '#dbeafe'}
            closeOnBackdrop={!isSubmitting}
            footer={(
                <>
                    <button type="button" className="btn btn-secondary" onClick={close} disabled={isSubmitting}>Cancelar</button>
                    <button type="submit" form="editorial-reason-form" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={isSubmitting}>
                        {isSubmitting ? 'Salvando...' : confirmLabel}
                    </button>
                </>
            )}
        >
            <form id="editorial-reason-form" onSubmit={submit}>
                {itemTitle && <p style={{ margin: '0 0 20px', color: 'var(--color-text-secondary)', lineHeight: 1.55 }}><strong style={{ color: 'var(--color-text-primary)' }}>{itemTitle}</strong></p>}
                <div className="input-group">
                    <label htmlFor="editorial-reason">{label} <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>(opcional)</span></label>
                    <textarea id="editorial-reason" className="input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={placeholder} rows={4} disabled={isSubmitting} />
                </div>
            </form>
        </Modal>
    )
}
