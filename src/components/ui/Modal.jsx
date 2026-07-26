import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from '../../hooks/useFocusTrap'

/**
 * Shared premium modal shell (glass header, rounded-24 card, pill-button
 * footer) — the same recipe already used by EditTaskModal and the task
 * delete/cancel confirmations, driven by the global .modal-backdrop/.modal
 * classes in components.css. New modals should use this instead of
 * hand-rolling overlay/header/close markup.
 *
 * Handles the behaviors every modal in this app is expected to have:
 * ESC to close, backdrop click to close (opt-out via closeOnBackdrop),
 * body scroll lock while open, focus trapped inside while open (via the
 * project's existing useFocusTrap hook), focus returned to the trigger
 * element on close, and role="dialog"/aria-modal/aria-labelledby.
 */
export default function Modal({
    isOpen,
    onClose,
    title,
    subtitle,
    icon: Icon,
    iconColor = 'var(--color-primary)',
    iconBg = 'var(--color-primary-light)',
    size = 'md', // 'md' | 'lg'
    footer,
    closeOnBackdrop = true,
    children,
}) {
    const cardRef = useRef(null)
    const previouslyFocusedRef = useRef(null)
    const titleId = useId()

    useFocusTrap(isOpen, cardRef)

    // ESC to close
    useEffect(() => {
        if (!isOpen) return
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose?.()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, onClose])

    // Lock body scroll while open
    useEffect(() => {
        if (!isOpen) return
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
            document.body.style.overflow = previousOverflow
        }
    }, [isOpen])

    // Remember what had focus before opening, restore it on close
    useEffect(() => {
        if (isOpen) {
            previouslyFocusedRef.current = document.activeElement
        } else if (previouslyFocusedRef.current instanceof HTMLElement) {
            previouslyFocusedRef.current.focus()
            previouslyFocusedRef.current = null
        }
    }, [isOpen])

    if (!isOpen) return null

    return (
        <div className="modal-backdrop" onClick={closeOnBackdrop ? onClose : undefined}>
            <div
                ref={cardRef}
                className={`modal ${size === 'lg' ? 'modal-large' : ''}`}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={title ? titleId : undefined}
            >
                <div className="modal-header">
                    <div>
                        {title && (
                            <h3 id={titleId} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                {Icon && (
                                    <span style={{
                                        background: iconBg,
                                        color: iconColor,
                                        padding: '8px',
                                        borderRadius: '10px',
                                        display: 'inline-flex',
                                        flexShrink: 0,
                                    }}>
                                        <Icon size={18} />
                                    </span>
                                )}
                                {title}
                            </h3>
                        )}
                        {subtitle && (
                            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                {subtitle}
                            </p>
                        )}
                    </div>
                    <button className="modal-close" onClick={onClose} aria-label="Fechar">
                        <X size={20} />
                    </button>
                </div>

                <div className="modal-body">
                    {children}
                </div>

                {footer && <div className="modal-footer">{footer}</div>}
            </div>
        </div>
    )
}
