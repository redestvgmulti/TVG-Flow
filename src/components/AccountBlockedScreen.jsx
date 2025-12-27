import { useAuth } from '../contexts/AuthContext'
import { AlertTriangle, Lock, XCircle } from 'lucide-react'

export default function AccountBlockedScreen({ status }) {
    const { signOut, professionalName, connectionStatus } = useAuth()

    const handleLogout = async () => {
        try {
            await signOut()
            window.location.href = '/login'
        } catch (error) {
            console.error('Error during logout:', error)
        }
    }

    // Se está offline, mostrar mensagem de conexão
    if (connectionStatus === 'offline') {
        return (
            <div className="centered-container">
                <div className="form-container" style={{ textAlign: 'center' }}>
                    <div style={{
                        width: '64px',
                        height: '64px',
                        background: 'var(--color-warning-bg)',
                        color: 'var(--color-warning)',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 24px'
                    }}>
                        <AlertTriangle size={32} />
                    </div>
                    <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '12px', color: 'var(--color-text-primary)' }}>
                        Sem Conexão
                    </h2>
                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px', lineHeight: '1.6' }}>
                        Você está sem conexão com a internet. Verifique sua conexão e tente novamente.
                    </p>
                    <p style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                        Sua sessão será restaurada automaticamente quando a conexão for reestabelecida.
                    </p>
                </div>
            </div>
        )
    }

    // Se está reconectando
    if (connectionStatus === 'reconnecting') {
        return (
            <div className="centered-container">
                <div className="form-container" style={{ textAlign: 'center' }}>
                    <div style={{
                        width: '64px',
                        height: '64px',
                        background: 'var(--color-primary-bg)',
                        color: 'var(--color-primary)',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 24px'
                    }}>
                        <div className="spinner" style={{ width: '32px', height: '32px' }}></div>
                    </div>
                    <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '12px', color: 'var(--color-text-primary)' }}>
                        Reconectando...
                    </h2>
                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px', lineHeight: '1.6' }}>
                        Restaurando sua sessão.
                    </p>
                </div>
            </div>
        )
    }

    // Conta inativa
    if (status === 'inactive') {
        return (
            <div className="centered-container">
                <div className="form-container" style={{ textAlign: 'center' }}>
                    <div style={{
                        width: '64px',
                        height: '64px',
                        background: 'var(--color-danger-bg)',
                        color: 'var(--color-danger)',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 24px'
                    }}>
                        <Lock size={32} />
                    </div>
                    <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '12px', color: 'var(--color-text-primary)' }}>
                        Conta Inativa
                    </h2>
                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px', lineHeight: '1.6' }}>
                        Olá, <strong>{professionalName}</strong>. Sua conta foi desativada pelo administrador.
                    </p>
                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: '32px', lineHeight: '1.6' }}>
                        Entre em contato com o administrador do sistema para mais informações.
                    </p>
                    <button onClick={handleLogout} className="form-button">
                        Sair
                    </button>
                </div>
            </div>
        )
    }

    // Empresa suspensa
    if (status === 'suspended') {
        return (
            <div className="centered-container">
                <div className="form-container" style={{ textAlign: 'center' }}>
                    <div style={{
                        width: '64px',
                        height: '64px',
                        background: 'var(--color-danger-bg)',
                        color: 'var(--color-danger)',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 24px'
                    }}>
                        <XCircle size={32} />
                    </div>
                    <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '12px', color: 'var(--color-text-primary)' }}>
                        Empresa Suspensa
                    </h2>
                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: '24px', lineHeight: '1.6' }}>
                        A conta da sua empresa foi suspensa temporariamente.
                    </p>
                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: '32px', lineHeight: '1.6' }}>
                        Entre em contato com o administrador do sistema para regularizar a situação.
                    </p>
                    <button onClick={handleLogout} className="form-button">
                        Sair
                    </button>
                </div>
            </div>
        )
    }

    return null
}
