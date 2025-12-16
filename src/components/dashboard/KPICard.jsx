import React from 'react';
// import './KPICard.css';

const KPICard = ({ title, value, icon, color = 'primary', onClick, trend, loading }) => {
    if (loading) {
        return (
            <div className="kpi-card kpi-card-loading">
                <div className="kpi-skeleton kpi-skeleton-icon"></div>
                <div className="kpi-skeleton kpi-skeleton-value"></div>
                <div className="kpi-skeleton kpi-skeleton-title"></div>
            </div>
        );
    }

    return (
        <div
            className={`kpi-card kpi-card-${color} ${onClick ? 'kpi-card-clickable' : ''}`}
            onClick={onClick}
            role={onClick ? 'button' : 'article'}
            tabIndex={onClick ? 0 : undefined}
        >
            <div className="kpi-icon">{icon}</div>
            <div className="kpi-value">{value}</div>
            <div className="kpi-title">{title}</div>
            {trend !== undefined && trend !== 0 && (
                <div className={`kpi-trend ${trend > 0 ? 'kpi-trend-up' : 'kpi-trend-down'}`}>
                    {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
                </div>
            )}
        </div>
    );
};

export default KPICard;
