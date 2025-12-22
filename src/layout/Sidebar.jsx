import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../services/supabase'
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

function Sidebar({ mobileMenuOpen, onClose }) {
    const { user, role, professionalName, signOut } = useAuth()
    const [adminPanelOpen, setAdminPanelOpen] = useState(true)
    const [profileOpen, setProfileOpen] = useState(false)
    const [incompleteTaskCount, setIncompleteTaskCount] = useState(0)

    // Fetch incomplete task count for staff
    useEffect(() => {
        if (role === 'profissional') {
            fetchIncompleteTaskCount()

            // Subscribe to real-time updates
            const subscription = supabase
                .channel('task_changes')
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'tarefas'
                }, () => {
                    fetchIncompleteTaskCount()
                })
                .subscribe()

            return () => {
                subscription.unsubscribe()
            }
        }
    }, [role])

    async function fetchIncompleteTaskCount() {
        try {
            const { count, error } = await supabase
                .from('tarefas')
                .select('*', { count: 'exact', head: true })
                .neq('status', 'completed')

            if (error) throw error
            setIncompleteTaskCount(count || 0)
        } catch (error) {
            console.error('Error fetching task count:', error)
        }
    }

    // Helper to get initials
    const getInitials = (name) => {
        return (name || 'U').charAt(0).toUpperCase()
    }

    // Close mobile menu when clicking nav link
    const handleNavClick = () => {
        onClose?.()
    }

    return (
        <>
            {/* Mobile Overlay */}
            {mobileMenuOpen && (
                <div
                    className="mobile-menu-overlay"
                    onClick={onClose}
                />
            )}

            {/* Sidebar */}
            <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
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
                                <NavLink to="/admin" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={handleNavClick}>
                                    <LayoutGrid size={20} className="nav-icon" />
                                    <span className="nav-text">Dashboard</span>
                                </NavLink>

                                <NavLink to="/admin/tasks" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={handleNavClick}>
                                    <CheckSquare size={20} className="nav-icon" />
                                    <span className="nav-text">Tarefas</span>
                                </NavLink>

                                <NavLink to="/admin/calendar" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={handleNavClick}>
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
                                            <NavLink to="/admin/areas" className="nav-sub-item" onClick={handleNavClick}>
                                                <Map size={16} />
                                                <span>Setores</span>
                                            </NavLink>
                                            <NavLink to="/admin/professionals" className="nav-sub-item" onClick={handleNavClick}>
                                                <Users size={16} />
                                                <span>Funcionários</span>
                                            </NavLink>
                                            <NavLink to="/admin/reports" className="nav-sub-item" onClick={handleNavClick}>
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
                            <NavLink to="/staff/dashboard" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={handleNavClick}>
                                <LayoutGrid size={20} className="nav-icon" />
                                <span className="nav-text">Dashboard</span>
                            </NavLink>

                            <NavLink to="/staff/tasks" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={handleNavClick}>
                                <CheckSquare size={20} className="nav-icon" />
                                <span className="nav-text">Minhas Tarefas</span>
                                {incompleteTaskCount > 0 && (
                                    <span
                                        className="ml-auto flex items-center justify-center"
                                        style={{
                                            minWidth: '20px',
                                            height: '20px',
                                            padding: '0 6px',
                                            borderRadius: '10px',
                                            background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                                            color: '#ffffff',
                                            fontSize: '11px',
                                            fontWeight: '700',
                                            boxShadow: '0 2px 4px rgba(239, 68, 68, 0.3)'
                                        }}
                                    >
                                        {incompleteTaskCount}
                                    </span>
                                )}
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
        </>
    )
}

export default Sidebar
