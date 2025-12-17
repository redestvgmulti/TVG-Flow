import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function Sidebar() {
    const { user, professionalName, signOut } = useAuth()
    const [adminPanelOpen, setAdminPanelOpen] = useState(false)
    const [profileOpen, setProfileOpen] = useState(false)

    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <h2>TVG Flow</h2>
            </div>

            <nav className="sidebar-nav">
                <NavLink to="/admin" end className="sidebar-link">
                    Dashboard
                </NavLink>

                <NavLink to="/admin/tasks" className="sidebar-link">
                    Tarefas
                </NavLink>

                {/* Painel Administrativo - Expansível */}
                <div className={`sidebar-group ${adminPanelOpen ? 'open' : ''}`}>
                    <button
                        className="sidebar-group-title"
                        onClick={() => setAdminPanelOpen(!adminPanelOpen)}
                    >
                        <span>Painel Administrativo</span>
                        <span className="sidebar-group-arrow">›</span>
                    </button>

                    {adminPanelOpen && (
                        <div className="sidebar-submenu">
                            <NavLink to="/admin/areas" className="sidebar-link">
                                Setores
                            </NavLink>
                            <NavLink to="/admin/professionals" className="sidebar-link">
                                Funcionários
                            </NavLink>
                            <NavLink to="/admin/reports" className="sidebar-link">
                                Relatórios
                            </NavLink>
                        </div>
                    )}
                </div>

                <NavLink to="/admin/calendar" className="sidebar-link">
                    Calendário
                </NavLink>
            </nav>

            {/* Perfil do Usuário - Rodapé */}
            <div className="sidebar-footer">
                <div className="sidebar-profile" onClick={() => setProfileOpen(!profileOpen)}>
                    <div className="sidebar-avatar">
                        {(professionalName || user?.email || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="sidebar-user-info">
                        <span className="sidebar-user-name">
                            {professionalName || 'Usuário'}
                        </span>
                        <span className="sidebar-user-email">
                            {user?.email}
                        </span>
                    </div>
                </div>

                {/* Dropdown do Perfil */}
                {profileOpen && (
                    <>
                        <div
                            style={{
                                position: 'fixed',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                zIndex: 999
                            }}
                            onClick={() => setProfileOpen(false)}
                        />
                        <div className="profile-dropdown">
                            <div className="profile-dropdown-header">
                                <p>{professionalName || 'Usuário'}</p>
                                <p>{user?.email}</p>
                            </div>

                            <div
                                className="profile-dropdown-item"
                                onClick={() => {/* TODO: Configurações */ }}
                            >
                                ⚙️ Configurações
                            </div>

                            <div
                                className="profile-dropdown-item"
                                onClick={() => {/* TODO: Ajuda */ }}
                            >
                                ❓ Ajuda
                            </div>

                            <div className="profile-dropdown-divider" />

                            <div
                                className="profile-dropdown-item logout"
                                onClick={signOut}
                            >
                                🚪 Sair
                            </div>
                        </div>
                    </>
                )}
            </div>
        </aside>
    )
}

export default Sidebar
