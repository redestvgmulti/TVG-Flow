import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import NotificationCenter from '../components/NotificationCenter'
import { Menu, X } from 'lucide-react'

function Header({ onMobileMenuToggle, mobileMenuOpen, hideMobileMenu }) {
    const { user, signOut } = useAuth()
    const [currentTime, setCurrentTime] = useState(new Date())
    const [systemMsg, setSystemMsg] = useState('Sistema operacional estável')

    useEffect(() => {
        // Update time every second
        const timer = setInterval(() => {
            setCurrentTime(new Date())
        }, 1000)

        // Rotate system messages every 15 seconds
        const messages = [
            'Sistema operacional estável',
            'Nenhuma tarefa crítica pendente',
            'Sincronização ativa',
            'Equipe de design com fluxo alto'
        ]

        let messageIndex = 0
        const msgTimer = setInterval(() => {
            messageIndex = (messageIndex + 1) % messages.length
            setSystemMsg(messages[messageIndex])
        }, 15000)

        return () => {
            clearInterval(timer)
            clearInterval(msgTimer)
        }
    }, [])

    // Format time and date
    const formattedTime = currentTime.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
    })

    const formattedDate = currentTime.toLocaleDateString('pt-BR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
    }).toUpperCase()

    return (
        <header className="status-bar">
            {/* Left: Mobile Menu + Context / Date */}
            <div className="status-left">
                {/* Mobile Menu Button - Hidden for Staff */}
                {!hideMobileMenu && (
                    <button
                        className="mobile-menu-btn"
                        onClick={onMobileMenuToggle}
                        aria-label="Toggle menu"
                    >
                        {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                )}

                <div className="status-clock" key={formattedTime}>
                    {formattedTime}
                </div>
                <div className="status-divider"></div>
                <div className="status-date" key={formattedDate}>
                    {formattedDate}
                </div>
            </div>

            {/* Center: System Pulse (Optional) */}
            <div className="status-center">
                <div className="system-pill">
                    <span className="status-dot"></span>
                    <span className="status-text" key={systemMsg}>{systemMsg}</span>
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
