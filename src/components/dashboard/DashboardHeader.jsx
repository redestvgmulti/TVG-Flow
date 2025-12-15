import React from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import './DashboardHeader.css';

const DashboardHeader = ({ userName = 'Admin', notificationCount = 0 }) => {
    const today = new Date();
    const greeting = getGreeting();
    const formattedDate = format(today, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });

    function getGreeting() {
        const hour = today.getHours();
        if (hour < 12) return 'Bom dia';
        if (hour < 18) return 'Boa tarde';
        return 'Boa noite';
    }

    return (
        <div className="dashboard-header">
            <div className="dashboard-header-content">
                <div className="dashboard-greeting-section">
                    <h1 className="dashboard-greeting">
                        {greeting}, {userName}
                    </h1>
                    <p className="dashboard-date">{formattedDate}</p>
                </div>

                {notificationCount > 0 && (
                    <div className="dashboard-notifications">
                        <button className="notification-button" aria-label="Notificações">
                            <span className="notification-icon">🔔</span>
                            <span className="notification-badge">{notificationCount}</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DashboardHeader;
