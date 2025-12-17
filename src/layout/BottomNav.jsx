import { NavLink } from 'react-router-dom'

function BottomNav() {
    return (
        <nav className="bottom-nav">
            <NavLink to="/admin" end className="bottom-nav-link">
                Dashboard
            </NavLink>
            <NavLink to="/admin/tasks" className="bottom-nav-link">
                Tasks
            </NavLink>
            <NavLink to="/admin/professionals" className="bottom-nav-link">
                Professionals
            </NavLink>
            <NavLink to="/admin/reports" className="bottom-nav-link">
                Reports
            </NavLink>
        </nav>
    )
}

export default BottomNav
