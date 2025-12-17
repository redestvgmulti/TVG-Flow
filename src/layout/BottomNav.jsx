import { NavLink } from 'react-router-dom'

function BottomNav() {
    return (
        <nav className="bottom-nav">
            <NavLink to="/admin" end className="bottom-nav-link">
                Painel
            </NavLink>
            <NavLink to="/admin/tasks" className="bottom-nav-link">
                Tarefas
            </NavLink>
            <NavLink to="/admin/professionals" className="bottom-nav-link">
                Profissionais
            </NavLink>
            <NavLink to="/admin/calendar" className="bottom-nav-link">
                Calendário
            </NavLink>
            <NavLink to="/admin/reports" className="bottom-nav-link">
                Relatórios
            </NavLink>
        </nav>
    )
}

export default BottomNav
