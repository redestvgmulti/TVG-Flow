import { NavLink } from 'react-router-dom'
import { LayoutGrid, CheckSquare, Users, Calendar, BarChart } from 'lucide-react'

function BottomNav() {
    return (
        <nav className="bottom-nav">
            <NavLink to="/admin" end className="bottom-nav-link">
                <LayoutGrid size={20} />
                <span>Painel</span>
            </NavLink>
            <NavLink to="/admin/tasks" className="bottom-nav-link">
                <CheckSquare size={20} />
                <span>Tarefas</span>
            </NavLink>
            <NavLink to="/admin/professionals" className="bottom-nav-link">
                <Users size={20} />
                <span>Profissionais</span>
            </NavLink>
            <NavLink to="/admin/calendar" className="bottom-nav-link">
                <Calendar size={20} />
                <span>Calendário</span>
            </NavLink>
            <NavLink to="/admin/reports" className="bottom-nav-link">
                <BarChart size={20} />
                <span>Relatórios</span>
            </NavLink>
        </nav>
    )
}

export default BottomNav
