import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from '../config/navigation'
import { useAuth } from '../contexts/AuthContext'

function BottomNav() {
    const { role } = useAuth()

    if (!role) return null

    return (
        <nav className="bottom-nav">
            {/* ADMIN NAV */}
            {(role === 'admin' || role === 'super_admin') && (
                <>
                    {/* Admin specific simplification for bottom nav if needed, or strictly follow NAV_ITEMS */}
                    {NAV_ITEMS.filter(item => (item.roles.includes('admin') || item.roles.includes('super_admin')) && item.showOnMobileBottom).map(item => (
                        <NavLink
                            key={item.key}
                            to={item.path}
                            end={item.path === '/admin'}
                            className="bottom-nav-link"
                        >
                            <item.icon size={20} />
                            <span>{item.label}</span>
                        </NavLink>
                    ))}
                </>
            )}

            {/* STAFF NAV */}
            {(role === 'staff' || role === 'profissional') && (
                <>
                    {NAV_ITEMS.filter(item => (item.roles.includes('staff') || item.roles.includes('profissional')) && item.key !== 'profile' && item.key !== 'staff-autopublisher' && item.showOnMobileBottom).map(item => (
                        <NavLink
                            key={item.key}
                            to={item.path}
                            className={({ isActive }) =>
                                item.isCTA
                                    ? `bottom-nav-link cta-button ${isActive ? 'active' : ''}`
                                    : `bottom-nav-link ${isActive ? 'active' : ''}`
                            }
                        >
                            <item.icon size={item.isCTA ? 24 : 20} />
                            <span>{item.label}</span>
                        </NavLink>
                    ))}
                </>
            )}

            {/* UNIVERSAL NON-ADMIN FAB OR NAV */}
            {role !== 'admin' && role !== 'super_admin' && (
                <>
                    {NAV_ITEMS.filter(item => item.key === 'staff-autopublisher').map(item => (
                        <NavLink
                            key={item.key}
                            to={item.path}
                            className={({ isActive }) => `bottom-nav-link ${isActive ? 'active' : ''}`}
                        >
                            <item.icon size={20} />
                            <span>{item.label}</span>
                        </NavLink>
                    ))}
                </>
            )}
        </nav>
    )
}

export default BottomNav
