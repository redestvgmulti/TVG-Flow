import { useNavigate } from 'react-router-dom'
import { Ban } from 'lucide-react'

export default function Suspended() {
    const navigate = useNavigate()

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
                    <Ban size={32} />
                </div>
                <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '12px', color: 'var(--color-text-primary)' }}>
                    Acesso Suspenso
                </h1>
                <p style={{ color: 'var(--color-text-secondary)', marginBottom: '32px', lineHeight: '1.6' }}>
                    Sua empresa foi suspensa. Entre em contato com o administrador.
                </p>
                <button onClick={() => navigate('/login')} className="form-button">
                    Voltar ao Login
                </button>
            </div>
        </div>
    )
}
