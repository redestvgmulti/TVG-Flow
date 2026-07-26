import { X } from 'lucide-react'

/**
 * Shared premium modal shell (glass header, rounded-24 card, pill-button
 * footer) — the same recipe already used by EditTaskModal and the task
 * delete/cancel confirmations, driven by the global .modal-backdrop/.modal
 * classes in components.css. New modals should use this instead of
 * hand-rolling overlay/header/close markup.
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
    if (!isOpen) return null

    return (
        <div className="modal-backdrop" onClick={closeOnBackdrop ? onClose : undefined}>
            <div
                className={`modal ${size === 'lg' ? 'modal-large' : ''}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="modal-header">
                    <div>
                        {title && (
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
