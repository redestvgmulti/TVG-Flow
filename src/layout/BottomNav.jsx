import { NavLink } from 'react-router-dom'
import { NAV_ITEMS } from '../config/navigation'
import { useAuth } from '../contexts/AuthContext'

function BottomNav() {
    const { role } = useAuth()

    if (!role) return null

    return (
        <nav className="bottom-nav">
            {/* ADMIN NAV */}
            {role === 'admin' && (
                <>
                    {/* Admin specific simplification for bottom nav if needed, or strictly follow NAV_ITEMS */}
                    {NAV_ITEMS.filter(item => item.roles.includes('admin') && item.showOnMobileBottom).map(item => (
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
            {role === 'staff' && (
                <>
                    {/* 
                      Order Requirement: Tasks, Agenda, Request (CTA), Content, Profile.
                      We filter items that have showOnMobileBottom=true. 
                      Note: Profile is NOT in NAV_ITEMS by default above for 'staff' in the config I wrote? 
                      Wait, I added 'key: profile' to NAV_ITEMS in the previous step.
                      So we can just map.
                    */}
                    {NAV_ITEMS.filter(item => item.roles.includes('staff') && item.showOnMobileBottom).map(item => (
                        <NavLink
                            key={item.key}
                            to={item.path}
                            // Request is special: CTA
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
        </nav>
    )
}

export default BottomNav
