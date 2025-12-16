import React from 'react';
import { NavLink } from 'react-router-dom';
import {
    Home,
    CheckSquare,
    Calendar,
    Users,
    Building,
    Briefcase,
    FileText,
    Settings,
    LogOut
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
// import './Sidebar.css';

const Sidebar = () => {
    const { signOut } = useAuth();

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="logo">TVG Flow</div>
            </div>

            <div className="sidebar-content">
                <div className="nav-group">
                    <span className="nav-label">Gerenciamento</span>
                    <NavLink to="/admin" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                        <Home size={20} />
                        <span>Dashboard</span>
                    </NavLink>
                    <NavLink to="/admin/tarefas" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                        <CheckSquare size={20} />
                        <span>Tarefas</span>
                    </NavLink>
                    <NavLink to="/admin/calendario" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                        <Calendar size={20} />
                        <span>Agenda</span>
                    </NavLink>
                </div>

                <div className="nav-group">
                    <span className="nav-label">Cadastros</span>
                    <NavLink to="/admin/profissionais" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                        <Users size={20} />
                        <span>Profissionais</span>
                    </NavLink>
                    <NavLink to="/admin/departamentos" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                        <Building size={20} />
                        <span>Departamentos</span>
                    </NavLink>
                    <NavLink to="/admin/clientes" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                        <Briefcase size={20} />
                        <span>Clientes</span>
                    </NavLink>
                </div>

                <div className="nav-group">
                    <span className="nav-label">Relatórios</span>
                    <NavLink to="/admin/relatorios" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                        <FileText size={20} />
                        <span>Métricas</span>
                    </NavLink>
                </div>
            </div>

            <div className="sidebar-footer">
                <NavLink to="/perfil" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
                    <Settings size={20} />
                    <span>Perfil</span>
                </NavLink>
                <button onClick={signOut} className="sidebar-link logout-btn">
                    <LogOut size={20} />
                    <span>Sair</span>
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
