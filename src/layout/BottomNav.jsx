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
            <NavLink to="/admin/calendar" className="bottom-nav-link">
                Calendar
            </NavLink>
        </nav>
    )
}

export default BottomNav
