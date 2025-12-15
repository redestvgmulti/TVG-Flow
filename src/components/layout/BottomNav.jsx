import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import './BottomNav.css';

const BottomNav = () => {
    const { profile } = useAuth();
    const location = useLocation();

    // Não mostrar bottom nav na página de login
    if (location.pathname === '/login') {
        return null;
    }

    const isAdmin = profile?.role === 'admin';

    const navItems = isAdmin ? [
        { path: '/admin', icon: '🏠', label: 'Hoje', exact: true },
        { path: '/admin/tarefas', icon: '✅', label: 'Tarefas' },
        { path: '/admin/calendario', icon: '📅', label: 'Calendário' },
        { path: '/admin/profissionais', icon: '👥', label: 'Equipe' },
        { path: '/perfil', icon: '👤', label: 'Perfil' },
    ] : [
        { path: '/profissional', icon: '🏠', label: 'Hoje', exact: true },
        { path: '/profissional/tarefas', icon: '✅', label: 'Tarefas' },
        { path: '/profissional/calendario', icon: '📅', label: 'Calendário' },
        { path: '/notificacoes', icon: '🔔', label: 'Notificações' },
        { path: '/perfil', icon: '👤', label: 'Perfil' },
    ];

    return (
        <nav className="bottom-nav">
            <div className="bottom-nav-container">
                {navItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        end={item.exact}
                        className={({ isActive }) =>
                            `bottom-nav-item ${isActive ? 'active' : ''}`
                        }
                    >
                        <span className="bottom-nav-icon">{item.icon}</span>
                        <span className="bottom-nav-label">{item.label}</span>
                    </NavLink>
                ))}
            </div>
        </nav>
    );
};

export default BottomNav;
