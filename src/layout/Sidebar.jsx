import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
    LayoutGrid,
    CheckSquare,
    Calendar,
    Settings,
    Users,
    BarChart,
    Map,
    ChevronRight,
    LogOut,
    User
} from 'lucide-react'

function Sidebar() {
    const { user, role, professionalName, signOut } = useAuth()
    const [adminPanelOpen, setAdminPanelOpen] = useState(true)
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
                    <div className="brand-dot"></div>
                    <h2>TVG Flow</h2>
                </div>
            </div>

            {/* Navigation */}
            <nav className="sidebar-nav">
                {/* ADMIN MENU */}
                {role === 'admin' && (
                    <>
                        <div className="nav-section">
                            <p className="nav-label">MENU PRINCIPAL</p>
                            <NavLink to="/admin" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                                <LayoutGrid size={20} className="nav-icon" />
                                <span className="nav-text">Dashboard</span>
                            </NavLink>

                            <NavLink to="/admin/tasks" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                                <CheckSquare size={20} className="nav-icon" />
                                <span className="nav-text">Tarefas</span>
                            </NavLink>

                            <NavLink to="/admin/calendar" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                                <Calendar size={20} className="nav-icon" />
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
                                    <Settings size={20} className="nav-icon" />
                                    <span className="nav-text">Administração</span>
                                    <ChevronRight size={16} className="nav-arrow" />
                                </button>

                                {adminPanelOpen && (
                                    <div className="nav-sub">
                                        <NavLink to="/admin/areas" className="nav-sub-item">
                                            <Map size={16} />
                                            <span>Setores</span>
                                        </NavLink>
                                        <NavLink to="/admin/professionals" className="nav-sub-item">
                                            <Users size={16} />
                                            <span>Funcionários</span>
                                        </NavLink>
                                        <NavLink to="/admin/reports" className="nav-sub-item">
                                            <BarChart size={16} />
                                            <span>Relatórios</span>
                                        </NavLink>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {/* STAFF MENU */}
                {role === 'profissional' && (
                    <div className="nav-section">
                        <p className="nav-label">MEU ESPAÇO</p>
                        <NavLink to="/staff/dashboard" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                            <LayoutGrid size={20} className="nav-icon" />
                            <span className="nav-text">Dashboard</span>
                        </NavLink>

                        <NavLink to="/staff/tasks" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                            <CheckSquare size={20} className="nav-icon" />
                            <span className="nav-text">Minhas Tarefas</span>
                        </NavLink>
                    </div>
                )}
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
                        <div className="profile-popup">
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
                                <LogOut size={16} className="text-danger" />
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
