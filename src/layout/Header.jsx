import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import NotificationCenter from '../components/NotificationCenter'

function Header() {
    const { user, signOut } = useAuth()
    const [time, setTime] = useState(new Date())
    const [systemMsg, setSystemMsg] = useState('Sistema operacional estável')

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000)

        // Simulação de mensagens rotativas do sistema
        const messages = [
            'Sistema operacional estável',
            'Nenhuma tarefa crítica pendente',
            'Sincronização ativa',
            'Equipe de design com fluxo alto'
        ]
        const msgTimer = setInterval(() => {
            const randomMsg = messages[Math.floor(Math.random() * messages.length)]
            setSystemMsg(randomMsg)
        }, 15000)

        return () => {
            clearInterval(timer)
            clearInterval(msgTimer)
        }
    }, [])

    return (
        <header className="admin-header">
            {/* Contexto Vivo / Status Bar */}
            <div className="header-status-area">
                <div className="status-item clock">
                    {time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="status-item">
                    <span style={{ opacity: 0.3 }}>|</span>
                    <span>{systemMsg}</span>
                </div>
            </div>

            <div className="header-actions">
                <NotificationCenter />
            </div>
        </header>
    )
}

export default Header
