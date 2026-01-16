import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../services/supabase'
import {
    CheckSquare,
    Calendar,
    Settings,
    Users,
    BarChart,
    ChevronRight,
    LogOut,
    Building,
    FolderOpen
} from 'lucide-react'
import { NAV_ITEMS, MANAGEMENT_ITEMS } from '../config/navigation'

function Sidebar({ mobileMenuOpen, onClose }) {
    const { user, role, professionalName, signOut } = useAuth()
    const [adminPanelOpen, setAdminPanelOpen] = useState(true)
    const [profileOpen, setProfileOpen] = useState(false)
    const [incompleteTaskCount, setIncompleteTaskCount] = useState(0)
    const [upcomingMeetingsCount, setUpcomingMeetingsCount] = useState(0)

    // Fetch incomplete task count and meetings count for staff
    useEffect(() => {
        if (role === 'staff' || role === 'profissional') {
            fetchIncompleteTaskCount()
            fetchUpcomingMeetingsCount()

            // Subscribe to real-time updates for tasks
            const taskSubscription = supabase
                .channel('task_changes')
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: 'tarefas'
                }, () => {
                    fetchIncompleteTaskCount()
                })
                .subscribe()

            // Subscribe to real-time updates for meetings
            const meetingSubscription = supabase
                .channel('meeting_changes')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'reunioes' }, () => fetchUpcomingMeetingsCount())
                .on('postgres_changes', { event: '*', schema: 'public', table: 'reunioes_participantes' }, () => fetchUpcomingMeetingsCount())
                .subscribe()

            return () => {
                taskSubscription.unsubscribe()
                meetingSubscription.unsubscribe()
            }
        }
    }, [role])

    async function fetchIncompleteTaskCount() {
        try {
            // Guard clause for missing auth
            if (!user) return

            const { count, error } = await supabase
                .from('tarefas')
                .select('*', { count: 'exact', head: true })
                .neq('status', 'completed')

            if (error) {
                // Silent fail - don't crash UI for a badge
                console.warn('Silent error fetching sidebar count:', error)
                return
            }

            setIncompleteTaskCount(count || 0)
        } catch (error) {
            console.error('Error fetching task count:', error)
            // Ensure state is valid
            setIncompleteTaskCount(0)
        }
    }

    async function fetchUpcomingMeetingsCount() {
        try {
            if (!user) return

            // RLS automatically filters by participant
            const { count, error } = await supabase
                .from('reunioes')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'scheduled')
            // Optional: Filter only future meetings?
            // .gte('data_inicio', new Date().toISOString())
            // Requirement: "mesmo comportamento que tarefas" (Tasks counts all pending).
            // So we count all 'scheduled' meetings.

            if (error) {
                console.warn('Silent error fetching meeting count:', error)
                return
            }

            setUpcomingMeetingsCount(count || 0)
        } catch (error) {
            console.error('Error fetching meeting count:', error)
            setUpcomingMeetingsCount(0)
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
                    {(role === 'admin' || role === 'super_admin') && (
                        <>
                            <div className="nav-section">
                                <p className="nav-label">MENU PRINCIPAL</p>
                                {NAV_ITEMS.filter(item => (item.roles.includes('admin') || item.roles.includes('super_admin')) && !item.isCTA && item.key !== 'admin-team' && item.key !== 'admin-reports').map(item => (
                                    <NavLink
                                        key={item.key}
                                        to={item.path}
                                        end={item.path === '/admin'} // Exact match for dashboard
                                        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                                        onClick={handleNavClick}
                                    >
                                        <item.icon size={20} className="nav-icon" />
                                        <span className="nav-text">{item.label}</span>
                                    </NavLink>
                                ))}
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
                                            {MANAGEMENT_ITEMS.map(item => (
                                                <NavLink
                                                    key={item.key}
                                                    to={item.path}
                                                    className="nav-sub-item"
                                                    onClick={handleNavClick}
                                                >
                                                    <item.icon size={16} />
                                                    <span>{item.label}</span>
                                                </NavLink>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )}

                    {/* STAFF MENU */}
                    {(role === 'staff' || role === 'profissional') && (
                        <div className="nav-section">
                            <p className="nav-label">MEU ESPAÇO</p>

                            {/* Render "Solicitar" specially if we want it at the top or emphasized, 
                                BUT User asked for strict hierarchy: Dashboard -> Tasks -> Calendar -> Content -> Request.
                                Let's map them in order of definition (which we can control via filter).
                            */}

                            {NAV_ITEMS.filter(item => (item.roles.includes('staff') || item.roles.includes('profissional')) && item.key !== 'profile').map(item => (
                                <NavLink
                                    key={item.key}
                                    to={item.path}
                                    end={item.path === '/staff/dashboard'}
                                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''} ${item.isCTA ? 'nav-item-cta' : ''}`}
                                    onClick={handleNavClick}
                                >
                                    <item.icon size={20} className="nav-icon" />
                                    <span className="nav-text">{item.label}</span>
                                    {item.key === 'tasks' && incompleteTaskCount > 0 && (
                                        <span className="nav-task-badge">
                                            {incompleteTaskCount}
                                        </span>
                                    )}
                                    {item.key === 'staff-meetings' && upcomingMeetingsCount > 0 && (
                                        <span className="nav-task-badge">
                                            {upcomingMeetingsCount}
                                        </span>
                                    )}
                                </NavLink>
                            ))}
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
