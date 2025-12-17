import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function Sidebar() {
    const { user } = useAuth()

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <h2>TVG Flow</h2>
                <p>{user?.email}</p>
            </div>

            <nav className="sidebar-nav">
                <NavLink to="/admin" end className="sidebar-link">
                    Dashboard
                </NavLink>
                <NavLink to="/admin/tasks" className="sidebar-link">
                    Tasks
                </NavLink>
                <NavLink to="/admin/professionals" className="sidebar-link">
                    Professionals
                </NavLink>
                <NavLink to="/admin/calendar" className="sidebar-link">
                    Calendar
                </NavLink>
                <NavLink to="/admin/reports" className="sidebar-link">
                    Reports
                </NavLink>
            </nav>
        </aside>
    )
}

export default Sidebar
