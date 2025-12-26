import { Outlet, useNavigate } from 'react-router-dom'
import { LogOut, LayoutGrid } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import '../styles/super-admin-layout.css'

export default function SuperAdminLayout() {
    const { signOut, professionalName } = useAuth()
    const navigate = useNavigate()

    async function handleLogout() {
        try {
            await signOut()
            navigate('/login')
        } catch (error) {
            console.error('Logout error:', error)
        }
    }

    return (
        <div className="super-admin-layout">
            <header className="super-admin-header">
                <div className="header-left">
                    <div className="logo-area">
                        <span className="logo-icon">⚡</span>
                        <span className="logo-text">TVG Flow Platform</span>
                    </div>
                </div>

                <div className="header-right">
                    <span className="admin-name">{professionalName} (Super Admin)</span>
                    <button onClick={handleLogout} className="btn-logout" title="Sair">
                        <LogOut size={18} />
                    </button>
                </div>
            </header>

            <main className="super-admin-content">
                <Outlet />
            </main>
        </div>
    )
}
