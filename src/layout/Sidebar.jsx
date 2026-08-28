import { useState, useEffect } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { usePermission } from '../hooks/usePermission' // NEW: Use permission hook
import { supabase } from '../services/supabase'
import { Settings, ChevronRight, LogOut } from 'lucide-react'
import { getNavigationItemsForRole } from '../config/navigation'

// AutoPublisher's matter stage tabs all collapse onto the single "Matérias"
// sidebar link, so its active state
// needs to match any of them, not just the bare /admin/autopublisher path.
const AUTOPUBLISHER_MATTER_TABS = ['coletadas', 'pendentes', 'em_producao', 'revisao', 'aprovadas', 'publicadas']

function Sidebar({ mobileMenuOpen, onClose }) {
    const { user, role, professionalName, signOut } = useAuth()
    const location = useLocation()
    const navigate = useNavigate()
    const { isSuperAdmin, isAdmin, isStaff } = usePermission() // NEW: Centralized permissions

    // Derived roles just for rendering logic (simplifies JSX conditions)
    const canSeeAdminMenu = isAdmin() || isSuperAdmin()
    const canSeeStaffMenu = isStaff()
    const roleItems = getNavigationItemsForRole(role)
    const adminMainItems = roleItems.filter((item) => item.section === 'main')
    const managementItems = roleItems.filter((item) => item.section === 'management')
    const staffItems = roleItems.filter((item) => item.section === 'staff')
    const toolItems = roleItems.filter((item) => item.section === 'tools')

    const [adminPanelOpen, setAdminPanelOpen] = useState(false)
    const [openNavGroups, setOpenNavGroups] = useState({})
    const toggleNavGroup = (key) => setOpenNavGroups(previous => ({ ...previous, [key]: !(previous[key] ?? false) }))
    const [profileOpen, setProfileOpen] = useState(false)
    const [incompleteTaskCount, setIncompleteTaskCount] = useState(0)
    const [upcomingMeetingsCount, setUpcomingMeetingsCount] = useState(0)

    async function fetchIncompleteTaskCount() {
        try {
            // Guard clause for missing auth
            if (!user) return

            const { count, error } = await supabase
                .from('tarefas')
                .select('*', { count: 'exact', head: true })
                .neq('status', 'concluida')

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

    // Counts are non-blocking: a failed badge never prevents navigation.
    useEffect(() => {
        if (!canSeeStaffMenu) return undefined

        const initialRefresh = window.setTimeout(() => {
            fetchIncompleteTaskCount()
            fetchUpcomingMeetingsCount()
        }, 0)

        const taskSubscription = supabase
            .channel('task_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tarefas' }, fetchIncompleteTaskCount)
            .subscribe()

        const meetingSubscription = supabase
            .channel('meeting_changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'reunioes' }, fetchUpcomingMeetingsCount)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'reunioes_participantes' }, fetchUpcomingMeetingsCount)
            .subscribe()

        return () => {
            window.clearTimeout(initialRefresh)
            taskSubscription.unsubscribe()
            meetingSubscription.unsubscribe()
        }
        // The count loaders read the current authenticated user and are only
        // re-subscribed when the role changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canSeeStaffMenu])

    // Helper to get initials
    const getInitials = (name) => {
        return (name || 'U').charAt(0).toUpperCase()
    }

    // Close mobile menu when clicking nav link
    const handleNavClick = () => {
        onClose?.()
    }

    function goToProfile() {
        const path = role === 'super_admin'
            ? '/platform/profile'
            : role === 'admin'
                ? '/admin/profile'
                : '/staff/profile'
        setProfileOpen(false)
        handleNavClick()
        navigate(path)
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
                        <img className="brand-logo-image" src="/images/tvg-hub-sidebar-brand.png" alt="TVG Hub" />
                    </div>
                </div>

                {/* Navigation */}
                <nav className="sidebar-nav">
                    {/* ADMIN MENU */}
                    {canSeeAdminMenu && (
                        <>
                            <div className="nav-section">
                                <p className="nav-label">MENU PRINCIPAL</p>
                                {adminMainItems.filter((item) => !item.isCTA).map(item => (
                                    item.children ? (
                                        <div key={item.key} className={`nav-group ${openNavGroups[item.key] ?? false ? 'open' : ''}`}>
                                            <button
                                                className="nav-group-trigger"
                                                onClick={() => toggleNavGroup(item.key)}
                                            >
                                                <item.icon size={20} className="nav-icon" />
                                                <span className="nav-text">{item.label}</span>
                                                <ChevronRight size={16} className="nav-arrow" />
                                            </button>

                                            {(openNavGroups[item.key] ?? false) && (
                                                <div className="nav-sub">
                                                    {item.children.map(child => {
                                                        const isPipelineRoot = child.path === item.path
                                                        const isActive = isPipelineRoot
                                                            ? location.pathname === child.path
                                                                || AUTOPUBLISHER_MATTER_TABS.some(t => location.pathname === `${child.path}/${t}`)
                                                            : location.pathname === child.path || location.pathname.startsWith(`${child.path}/`)
                                                        return (
                                                            <NavLink
                                                                key={child.key}
                                                                to={child.path}
                                                                className={`nav-sub-item ${isActive ? 'active' : ''}`}
                                                                onClick={handleNavClick}
                                                            >
                                                                <child.icon size={16} />
                                                                <span>{child.label}</span>
                                                            </NavLink>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
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
                                    )
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
                                            {managementItems.map(item => (
                                                <NavLink
                                                    key={item.key}
                                                    to={item.path}
                                                    className={({ isActive }) => `nav-sub-item ${isActive ? 'active' : ''}`}
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
                    {canSeeStaffMenu && (
                        <div className="nav-section">
                            <p className="nav-label">MEU ESPAÇO</p>

                            {staffItems.map(item => (
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

                    {/* FERRMENTAS (Disponível para todos exceto admin) */}
                    {canSeeStaffMenu && toolItems.length > 0 && (
                        <div className="nav-section">
                            <p className="nav-label">FERRAMENTAS</p>
                            {toolItems.map(item => (
                                <NavLink
                                    key={item.key}
                                    to={item.path}
                                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                                    onClick={handleNavClick}
                                >
                                    <item.icon size={20} className="nav-icon" />
                                    <span className="nav-text">{item.label}</span>
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
                                <button type="button" className="popup-header popup-profile-link" onClick={goToProfile}>
                                    <div className="popup-avatar">
                                        {getInitials(professionalName)}
                                    </div>
                                    <div>
                                        <p className="popup-name">{professionalName}</p>
                                        <p className="popup-email">{user?.email}</p>
                                    </div>
                                </button>
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
