import React from 'react'
import { Info } from 'lucide-react'
import '../styles/permission-guard.css'

/**
 * PermissionGuard - ETAPA 4 FASE 3
 * Wrapper condicional que esconde/desabilita conteúdo baseado em permissão
 * Mostra tooltip explicativo quando bloqueado
 */
export default function PermissionGuard({
    can,
    children,
    fallback = null,
    showTooltip = true,
    tooltipMessage = 'Você não tem permissão para esta ação',
    mode = 'hide' // 'hide' | 'disable'
}) {
    // Se tem permissão, renderiza normalmente
    if (can) {
        return <>{children}</>
    }

    // Se não tem permissão
    if (mode === 'hide') {
        return fallback
    }

    // Mode 'disable': renderiza mas desabilitado
    return (
        <div className="permission-guard-disabled">
            {React.cloneElement(children, { disabled: true })}
            {showTooltip && (
                <div className="permission-guard-tooltip">
                    <Info size={14} />
                    <span>{tooltipMessage}</span>
                </div>
            )}
        </div>
    )
}

/**
 * PermissionButton - Botão com guard integrado
 */
export function PermissionButton({
    can,
    onClick,
    children,
    tooltipMessage,
    className = '',
    ...props
}) {
    const handleClick = (e) => {
        if (!can) {
            e.preventDefault()
            return
        }
        onClick?.(e)
    }

    return (
        <div className={`permission-button-wrapper ${!can ? 'disabled' : ''}`}>
            <button
                onClick={handleClick}
                disabled={!can}
                className={className}
                {...props}
            >
                {children}
            </button>
            {!can && tooltipMessage && (
                <div className="permission-tooltip">
                    {tooltipMessage}
                </div>
            )}
        </div>
    )
}
