import { NavLink } from 'react-router-dom'
import { LayoutGrid, CheckSquare, Users, Calendar, BarChart, PlusSquare, User } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

function BottomNav() {
    const { role } = useAuth()

    if (!role) return null

    return (
        <nav className="bottom-nav">
            {/* ADMIN NAV */}
            {role === 'admin' && (
                <>
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
                        <span>Equipe</span>
                    </NavLink>
                    <NavLink to="/admin/calendar" className="bottom-nav-link">
                        <Calendar size={20} />
                        <span>Agenda</span>
                    </NavLink>
                    <NavLink to="/admin/reports" className="bottom-nav-link">
                        <BarChart size={20} />
                        <span>Relatórios</span>
                    </NavLink>
                </>
            )}

            {/* STAFF NAV */}
            {role === 'profissional' && (
                <>
                    <NavLink to="/staff/dashboard" end className="bottom-nav-link">
                        <LayoutGrid size={20} />
                        <span>Painel</span>
                    </NavLink>
                    <NavLink to="/staff/tasks" className="bottom-nav-link">
                        <CheckSquare size={20} />
                        <span>Tarefas</span>
                    </NavLink>
                    <NavLink to="/staff/requests/new" className="bottom-nav-link">
                        <PlusSquare size={20} />
                        <span>Solicitar</span>
                    </NavLink>
                    <NavLink to="/staff/calendar" className="bottom-nav-link">
                        <Calendar size={20} />
                        <span>Agenda</span>
                    </NavLink>
                    <NavLink to="/staff/profile" className="bottom-nav-link">
                        <User size={20} />
                        <span>Perfil</span>
                    </NavLink>
                </>
            )}
        </nav>
    )
}

export default BottomNav
