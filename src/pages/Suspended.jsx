import { Ban } from 'lucide-react'

export default function Suspended() {
    return (
        <div style={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f8fafc',
            color: '#0f172a',
            fontFamily: 'Inter, sans-serif'
        }}>
            <Ban size={64} color="#ef4444" style={{ marginBottom: '24px' }} />
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>Acesso Suspenso</h1>
            <p style={{ color: '#64748b' }}>Sua empresa foi suspensa. Entre em contato com o administrador.</p>
        </div>
    )
}
