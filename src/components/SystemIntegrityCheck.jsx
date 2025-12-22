import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { AlertTriangle, CheckCircle, XCircle } from 'lucide-react'

/**
 * SystemIntegrityCheck - Admin-only component
 * Validates system integrity on admin panel load
 * Blocks critical operations if system is inconsistent
 */
function SystemIntegrityCheck({ onIntegrityStatus }) {
    const [checking, setChecking] = useState(true)
    const [status, setStatus] = useState(null)
    const [issues, setIssues] = useState(null)
    const [showDetails, setShowDetails] = useState(false)

    useEffect(() => {
        checkSystemIntegrity()
    }, [])

    async function checkSystemIntegrity() {
        try {
            setChecking(true)

            // Call Edge Function for system validation
            const { data, error } = await supabase.functions.invoke('system-check')

            if (error) {
                console.error('System check error:', error)
                setStatus('ERROR')
                setIssues({
                    message: 'Falha ao verificar integridade do sistema',
                    details: []
                })
                onIntegrityStatus?.('ERROR')
                return
            }

            const systemStatus = data?.system_integrity?.status || 'UNKNOWN'
            setStatus(systemStatus)
            setIssues(data?.system_integrity?.issues || {})

            // Notify parent component
            onIntegrityStatus?.(systemStatus)

        } catch (error) {
            console.error('Unexpected error during system check:', error)
            setStatus('ERROR')
            onIntegrityStatus?.('ERROR')
        } finally {
            setChecking(false)
        }
    }

    // Don't render anything if checking or if system is OK
    if (checking) {
        return null
    }

    if (status === 'OK') {
        return null
    }

    // Show warning banner if system has issues
    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 9999,
                background: 'linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)',
                color: 'white',
                padding: '12px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                borderBottom: '2px solid #991B1B'
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <AlertTriangle size={24} />
                <div>
                    <p style={{
                        margin: 0,
                        fontWeight: 600,
                        fontSize: '14px',
                        lineHeight: '1.4'
                    }}>
                        ⚠️ Sistema Inconsistente
                    </p>
                    <p style={{
                        margin: 0,
                        fontSize: '12px',
                        opacity: 0.9,
                        lineHeight: '1.4'
                    }}>
                        Migrations obrigatórias não aplicadas. Operações críticas bloqueadas.
                    </p>
                </div>
            </div>

            <button
                onClick={() => setShowDetails(!showDetails)}
                style={{
                    background: 'rgba(255, 255, 255, 0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.3)',
                    color: 'white',
                    padding: '6px 12px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontWeight: 500
                }}
            >
                {showDetails ? 'Ocultar Detalhes' : 'Ver Detalhes'}
            </button>

            {/* Details Modal */}
            {showDetails && (
                <div
                    style={{
                        position: 'fixed',
                        top: '60px',
                        right: '20px',
                        width: '400px',
                        maxHeight: '500px',
                        overflow: 'auto',
                        background: 'white',
                        color: '#1e293b',
                        borderRadius: '8px',
                        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
                        padding: '20px',
                        zIndex: 10000
                    }}
                >
                    <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 600 }}>
                        Problemas Detectados
                    </h3>

                    {issues?.missing_migrations?.length > 0 && (
                        <div style={{ marginBottom: '16px' }}>
                            <p style={{
                                margin: '0 0 8px 0',
                                fontSize: '13px',
                                fontWeight: 600,
                                color: '#DC2626'
                            }}>
                                <XCircle size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                                Migrations Faltando:
                            </p>
                            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px' }}>
                                {issues.missing_migrations.map((migration, i) => (
                                    <li key={i} style={{ marginBottom: '4px' }}>{migration}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {issues?.missing_tables?.length > 0 && (
                        <div style={{ marginBottom: '16px' }}>
                            <p style={{
                                margin: '0 0 8px 0',
                                fontSize: '13px',
                                fontWeight: 600,
                                color: '#DC2626'
                            }}>
                                <XCircle size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                                Tabelas Faltando:
                            </p>
                            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px' }}>
                                {issues.missing_tables.map((table, i) => (
                                    <li key={i} style={{ marginBottom: '4px' }}>{table}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {issues?.rls_issues?.length > 0 && (
                        <div style={{ marginBottom: '16px' }}>
                            <p style={{
                                margin: '0 0 8px 0',
                                fontSize: '13px',
                                fontWeight: 600,
                                color: '#DC2626'
                            }}>
                                <XCircle size={16} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
                                Problemas de RLS:
                            </p>
                            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px' }}>
                                {issues.rls_issues.map((issue, i) => (
                                    <li key={i} style={{ marginBottom: '4px' }}>{issue}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div style={{
                        marginTop: '16px',
                        paddingTop: '16px',
                        borderTop: '1px solid #e2e8f0',
                        fontSize: '12px',
                        color: '#64748b'
                    }}>
                        <p style={{ margin: 0 }}>
                            <strong>Ação necessária:</strong> Contate o administrador técnico para aplicar as migrations pendentes.
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}

export default SystemIntegrityCheck
