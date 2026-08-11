import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { LogOut, LayoutDashboard, Building2, BarChart3, Activity, Menu, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import '../styles/super-admin-layout.css'

export default function SuperAdminLayout() {
    const { signOut, professionalName } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

    async function handleLogout() {
        try {
            await signOut()
            navigate('/login')
        } catch (error) {
            console.error('Logout error:', error)
        }
    }

    const menuItems = [
        { path: '/platform', icon: LayoutDashboard, label: 'Dashboard' },
        { path: '/platform/companies', icon: Building2, label: 'Empresas' },
        { path: '/platform/reports', icon: BarChart3, label: 'Relatórios' },
        { path: '/platform/system', icon: Activity, label: 'Status do Sistema' },
    ]

    const handleNavigate = (path) => {
        navigate(path)
        setMobileMenuOpen(false)
    }

    return (
        <div className="super-admin-layout">
            <header className="super-admin-mobile-header">
                <button
                    className="super-admin-mobile-menu-btn"
                    onClick={() => setMobileMenuOpen(open => !open)}
                    aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'}
                >
                    {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                </button>
                <span className="super-admin-logo-surface">
                    <img className="super-admin-logo-image" src="/images/tvg-hub-brand.png" alt="TVG Hub" />
                </span>
            </header>

            {mobileMenuOpen && (
                <div className="super-admin-mobile-overlay" onClick={() => setMobileMenuOpen(false)} />
            )}

            <aside className={`super-admin-sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
                <div className="sidebar-header">
                    <span className="super-admin-logo-surface">
                        <img className="super-admin-logo-image" src="/images/tvg-hub-brand.png" alt="TVG Hub" />
                    </span>
                </div>

                <nav className="sidebar-nav">
                    {menuItems.map(item => {
                        const Icon = item.icon
                        const isActive = location.pathname === item.path
                        return (
                            <button
                                key={item.path}
                                onClick={() => handleNavigate(item.path)}
                                className={`nav-item ${isActive ? 'active' : ''}`}
                            >
                                <Icon size={20} />
                                <span>{item.label}</span>
                            </button>
                        )
                    })}
                </nav>

                <div className="sidebar-footer">
                    <div className="admin-info">
                        <div className="admin-name">{professionalName}</div>
                        <div className="admin-role">Super Admin</div>
                    </div>
                    <button onClick={handleLogout} className="btn-logout" title="Sair">
                        <LogOut size={18} />
                    </button>
                </div>
            </aside>

            <main className="super-admin-content">
                <Outlet />
            </main>
        </div>
    )
}
