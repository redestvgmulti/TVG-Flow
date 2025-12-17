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
                    Painel
                </NavLink>
                <NavLink to="/admin/tasks" className="sidebar-link">
                    Tarefas
                </NavLink>
                <NavLink to="/admin/professionals" className="sidebar-link">
                    Profissionais
                </NavLink>
                <NavLink to="/admin/calendar" className="sidebar-link">
                    Calendário
                </NavLink>
                <NavLink to="/admin/reports" className="sidebar-link">
                    Relatórios
                </NavLink>
            </nav>
        </aside>
    )
}

export default Sidebar
