import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function Sidebar() {
    const { user, professionalName, signOut } = useAuth()
    const [adminPanelOpen, setAdminPanelOpen] = useState(true) // Default open for better discovery
    const [profileOpen, setProfileOpen] = useState(false)

    // Helper to get initials
    const getInitials = (name) => {
        return (name || 'U').charAt(0).toUpperCase()
    }

    return (
        <aside className="sidebar">
            {/* Logo Area */}
            <div className="sidebar-header">
                <div className="brand-logo">
                    <span className="brand-dot"></span>
                    <h2>TVG Flow</h2>
                </div>
            </div>

            {/* Navigation */}
            <nav className="sidebar-nav">
                <div className="nav-section">
                    <p className="nav-label">MENU PRINCIPAL</p>
                    <NavLink to="/admin" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <span className="nav-icon">📊</span>
                        <span className="nav-text">Dashboard</span>
                    </NavLink>

                    <NavLink to="/admin/tasks" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <span className="nav-icon">✅</span>
                        <span className="nav-text">Tarefas</span>
                    </NavLink>

                    <NavLink to="/admin/calendar" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <span className="nav-icon">📅</span>
                        <span className="nav-text">Calendário</span>
                    </NavLink>
                </div>

                <div className="nav-section">
                    <p className="nav-label">GERENCIAMENTO</p>
                    {/* Admin Panel Group */}
                    <div className={`nav-group ${adminPanelOpen ? 'open' : ''}`}>
                        <button
                            className="nav-group-trigger"
                            onClick={() => setAdminPanelOpen(!adminPanelOpen)}
                        >
                            <span className="nav-icon">⚙️</span>
                            <span className="nav-text">Administração</span>
                            <span className="nav-arrow">›</span>
                        </button>

                        {adminPanelOpen && (
                            <div className="nav-sub">
                                <NavLink to="/admin/areas" className="nav-sub-item">
                                    Setores
                                </NavLink>
                                <NavLink to="/admin/professionals" className="nav-sub-item">
                                    Funcionários
                                </NavLink>
                                <NavLink to="/admin/reports" className="nav-sub-item">
                                    Relatórios
                                </NavLink>
                            </div>
                        )}
                    </div>
                </div>
            </nav>

            {/* User Profile Footer */}
            <div className="sidebar-footer">
                <div className={`user-menu ${profileOpen ? 'active' : ''}`} onClick={() => setProfileOpen(!profileOpen)}>
                    <div className="user-avatar">
                        {getInitials(professionalName || user?.email)}
                    </div>
                    <div className="user-info">
                        <span className="user-name">{professionalName || 'Usuário'}</span>
                        <span className="user-role">Online</span>
                    </div>
                    <div className="user-status-indicator"></div>
                </div>

                {/* Profile Popup */}
                {profileOpen && (
                    <>
                        <div className="backdrop-invisible" onClick={() => setProfileOpen(false)} />
                        <div className="profile-popup glasses">
                            <div className="popup-header">
                                <div className="popup-avatar">
                                    {getInitials(professionalName)}
                                </div>
                                <div>
                                    <p className="popup-name">{professionalName}</p>
                                    <p className="popup-email">{user?.email}</p>
                                </div>
                            </div>
                            <div className="popup-divider" />
                            <div className="popup-item" onClick={signOut}>
                                <span className="text-danger">Sair do Sistema</span>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </aside>
    )
}

export default Sidebar
