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
        <header className="status-bar">
            {/* Left: Context / Date */}
            <div className="status-left">
                <div className="status-clock">
                    {time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="status-divider"></div>
                <div className="status-date">
                    {time.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}
                </div>
            </div>

            {/* Center: System Pulse (Optional) */}
            <div className="status-center">
                <div className="system-pill">
                    <span className="status-dot"></span>
                    <span className="status-text">{systemMsg}</span>
                </div>
            </div>

            {/* Right: Actions */}
            <div className="status-right">
                <NotificationCenter />
            </div>
        </header>
    )
}

export default Header
