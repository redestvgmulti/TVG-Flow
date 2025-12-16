import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Home, CheckSquare, Calendar, Menu, Users, Building, Briefcase, FileText } from 'lucide-react';
import './BottomNav.css';

const BottomNav = ({ onMenuClick }) => {
    return (
        <nav className="bottom-nav">
            <NavLink
                to="/admin"
                end
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
                <Home size={24} />
                <span>Home</span>
            </NavLink>

            <NavLink
                to="/admin/tarefas"
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
                <CheckSquare size={24} />
                <span>Tarefas</span>
            </NavLink>

            <NavLink
                to="/admin/calendario"
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
                <Calendar size={24} />
                <span>Agenda</span>
            </NavLink>

            <button className="nav-item" onClick={onMenuClick}>
                <Menu size={24} />
                <span>Menu</span>
            </button>
        </nav>
    );
};

export default BottomNav;
