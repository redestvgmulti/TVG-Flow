import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import './Modal.css';

const Modal = ({
    isOpen,
    onClose,
    title,
    children,
    footer,
    size = 'medium', // small, medium, large
    closeOnBackdrop = true,
    closeOnEsc = true,
}) => {
    // Fechar com ESC
    useEffect(() => {
        if (!isOpen || !closeOnEsc) return;

        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, [isOpen, closeOnEsc, onClose]);

    // Prevenir scroll do body quando modal aberto
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }

        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    if (!isOpen) return null;

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget && closeOnBackdrop) {
            onClose();
        }
    };

    const modalContent = (
        <>
            <div className="modal-backdrop" onClick={handleBackdropClick}>
                <div className={`modal modal-${size}`} onClick={(e) => e.stopPropagation()}>
                    {/* Header */}
                    <div className="modal-header">
                        <h2 className="modal-title">{title}</h2>
                        <button
                            className="modal-close-button"
                            onClick={onClose}
                            aria-label="Fechar"
                        >
                            ×
                        </button>
                    </div>

                    {/* Body */}
                    <div className="modal-body">
                        {children}
                    </div>

                    {/* Footer */}
                    {footer && (
                        <div className="modal-footer">
                            {footer}
                        </div>
                    )}
                </div>
            </div>
        </>
    );

    return createPortal(modalContent, document.body);
};

export default Modal;
