import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import NotificationCenter from '../components/NotificationCenter'
import { Menu, X } from 'lucide-react'
import { supabase } from '../services/supabase'
import { getOperationalStatus } from '../services/operationalStatus'

function Header({ onMobileMenuToggle, mobileMenuOpen, hideMobileMenu }) {
    const { user, role } = useAuth()
    const navigate = useNavigate()
    const [currentTime, setCurrentTime] = useState(new Date())
    const [operationalStatus, setOperationalStatus] = useState({
        tone: 'unavailable',
        message: 'Status operacional indisponível'
    })

    useEffect(() => {
        const timer = window.setInterval(() => setCurrentTime(new Date()), 1000)
        return () => window.clearInterval(timer)
    }, [])

    useEffect(() => {
        if (!user?.id) {
            return undefined
        }

        let isMounted = true
        const refreshOperationalStatus = async () => {
            try {
                const status = await getOperationalStatus()
                if (isMounted) setOperationalStatus(status)
            } catch (error) {
                console.warn('Unable to load operational status:', error)
                if (isMounted) setOperationalStatus({ tone: 'unavailable', message: 'Status operacional indisponível' })
            }
        }

        refreshOperationalStatus()
        const refreshTimer = window.setInterval(refreshOperationalStatus, 60_000)
        const channel = supabase
            .channel(`header-operational-status-${user.id}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tarefas' }, refreshOperationalStatus)
            .subscribe()

        return () => {
            isMounted = false
            window.clearInterval(refreshTimer)
            channel.unsubscribe()
        }
    }, [user?.id])

    function openRelevantTasks() {
        if (operationalStatus.tone === 'loading' || operationalStatus.tone === 'unavailable') return
        if (role === 'staff') return navigate('/staff/tasks')
        navigate(operationalStatus.tone === 'critical' ? '/admin/tasks?status=overdue' : '/admin/tasks')
    }

    const formattedTime = currentTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    const formattedDate = currentTime.toLocaleDateString('pt-BR', {
        weekday: 'short', day: 'numeric', month: 'short'
    }).toUpperCase()

    return (
        <header className="status-bar">
            <div className="status-left">
                {!hideMobileMenu && (
                    <button className="mobile-menu-btn" onClick={onMobileMenuToggle} aria-label="Abrir menu">
                        {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                )}
                <div className="status-clock" key={formattedTime}>{formattedTime}</div>
                <div className="status-divider"></div>
                <div className="status-date" key={formattedDate}>{formattedDate}</div>
            </div>

            <div className="status-center">
                <button
                    type="button"
                    className={`system-pill system-pill--${operationalStatus.tone}`}
                    onClick={openRelevantTasks}
                    disabled={operationalStatus.tone === 'loading' || operationalStatus.tone === 'unavailable'}
                    aria-label={`${operationalStatus.message}. Abrir tarefas relacionadas.`}
                >
                    <span className="status-dot"></span>
                    <span className="status-text">{operationalStatus.message}</span>
                </button>
            </div>

            <div className="status-right"><NotificationCenter /></div>
        </header>
    )
}

export default Header
