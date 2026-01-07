import React, { useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import '../styles/permission-guard.css'

/**
 * BlockedActionModal - ETAPA 4 FASE 3
 * Modal que explica por que uma ação foi bloqueada
 */
export default function BlockedActionModal({
    isOpen,
    onClose,
    actionName,
    reason,
    whoCanDo
}) {
    if (!isOpen) return null

    return (
        <div className="blocked-action-modal" onClick={onClose}>
            <div className="blocked-action-content" onClick={(e) => e.stopPropagation()}>
                <div className="blocked-action-header">
                    <AlertCircle size={24} />
                    <h3>Ação não permitida</h3>
                </div>

                <div className="blocked-action-body">
                    <p>
                        Você não tem permissão para <strong>{actionName}</strong>.
                    </p>

                    {reason && (
                        <div className="blocked-action-reason">
                            <strong>Motivo:</strong>
                            <p>{reason}</p>
                        </div>
                    )}

                    {whoCanDo && (
                        <div className="blocked-action-reason">
                            <strong>Quem pode executar:</strong>
                            <p>{whoCanDo}</p>
                        </div>
                    )}
                </div>

                <div className="blocked-action-actions">
                    <button onClick={onClose}>
                        Entendi
                    </button>
                </div>
            </div>
        </div>
    )
}

/**
 * Hook helper para modal de bloqueio
 */
export function useBlockedActionModal() {
    const [isOpen, setIsOpen] = useState(false)
    const [config, setConfig] = useState({})

    const showBlocked = (actionName, reason, whoCanDo) => {
        setConfig({ actionName, reason, whoCanDo })
        setIsOpen(true)
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    return { isOpen, config, showBlocked, closeModal }
}
