import { NavLink } from 'react-router-dom'
import { getNavigationItemsForRole } from '../config/navigation'
import { useAuth } from '../contexts/AuthContext'

function BottomNav() {
    const { role } = useAuth()
    const items = getNavigationItemsForRole(role).filter((item) => item.showOnMobileBottom)

    if (!role || !items.length) return null

    return (
        <nav className="bottom-nav" aria-label="Navegação principal">
            {items.map((item) => (
                <NavLink
                    key={item.key}
                    to={item.path}
                    end={item.path === '/admin' || item.path === '/staff/dashboard'}
                    className={({ isActive }) => `bottom-nav-link ${isActive ? 'active' : ''}`}
                >
                    <item.icon size={20} />
                    <span>{item.label}</span>
                </NavLink>
            ))}
        </nav>
    )
}

export default BottomNav
