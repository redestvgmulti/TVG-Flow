import React, { useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useDashboardData, useRealtimeDashboard } from '../../hooks/useDashboard';
import DashboardHeader from '../../components/dashboard/DashboardHeader';
import KPICard from '../../components/dashboard/KPICard';
import TaskCard from '../../components/dashboard/TaskCard';
import TeamWorkload from '../../components/dashboard/TeamWorkload';
import './Dashboard.css';

const AdminDashboard = () => {
    const { profile } = useAuth();
    const {
        loading,
        error,
        metrics,
        todayTasks,
        overdueTasks,
        teamWorkload,
        refresh,
    } = useDashboardData();

    // Real-time updates
    useRealtimeDashboard(
        useCallback(() => {
            console.log('Atualizando dashboard em tempo real...');
            refresh();
        }, [refresh])
    );

    const handleTaskClick = (task) => {
        console.log('Task clicked:', task);
        // TODO: Abrir modal de detalhes da tarefa
    };

    const handleMemberClick = (member) => {
        console.log('Member clicked:', member);
        // TODO: Navegar para view de profissional
    };

    const handleKPIClick = (type) => {
        console.log('KPI clicked:', type);
        // TODO: Navegar para view filtrada
    };

    if (error) {
        return (
            <div className="admin-dashboard">
                <div className="dashboard-error">
                    <h2>Erro ao carregar dashboard</h2>
                    <p>{error}</p>
                    <button onClick={refresh} className="btn-retry">
                        Tentar Novamente
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="admin-dashboard">
            <DashboardHeader
                userName={profile?.nome || 'Admin'}
                notificationCount={overdueTasks?.length || 0}
            />

            {/* KPI Cards */}
            <div className="kpi-section">
                <div className="kpi-cards-container">
                    <KPICard
                        title="Hoje"
                        value={metrics?.tasksToday || 0}
                        icon="📋"
                        color="primary"
                        onClick={() => handleKPIClick('today')}
                        loading={loading}
                    />
                    <KPICard
                        title="Atrasadas"
                        value={metrics?.overdueTasks?.length || 0}
                        icon="⚠️"
                        color="danger"
                        onClick={() => handleKPIClick('overdue')}
                        loading={loading}
                    />
                    <KPICard
                        title="Concluídas"
                        value={metrics?.completedToday || 0}
                        icon="✅"
                        color="success"
                        onClick={() => handleKPIClick('completed')}
                        loading={loading}
                    />
                    <KPICard
                        title="Esta Semana"
                        value={metrics?.tasksThisWeek || 0}
                        icon="📅"
                        color="info"
                        onClick={() => handleKPIClick('week')}
                        loading={loading}
                    />
                    <KPICard
                        title="Profissionais"
                        value={metrics?.activeProfessionals || 0}
                        icon="👥"
                        color="primary"
                        onClick={() => handleKPIClick('team')}
                        loading={loading}
                    />
                </div>
            </div>

            {/* Overdue Tasks - Priority Section */}
            {overdueTasks && overdueTasks.length > 0 && (
                <div className="dashboard-section overdue-section">
                    <div className="section-header">
                        <h2 className="section-title">⚠️ Tarefas Atrasadas ({overdueTasks.length})</h2>
                    </div>
                    <div className="tasks-list">
                        {overdueTasks.slice(0, 5).map((task) => (
                            <TaskCard
                                key={task.id}
                                task={task}
                                onClick={handleTaskClick}
                            />
                        ))}
                        {overdueTasks.length > 5 && (
                            <button className="btn-view-all">
                                Ver todas as {overdueTasks.length} tarefas atrasadas
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Today's Tasks */}
            <div className="dashboard-section">
                <div className="section-header">
                    <h2 className="section-title">📋 Tarefas de Hoje</h2>
                    {todayTasks && todayTasks.length > 0 && (
                        <span className="section-count">{todayTasks.length}</span>
                    )}
                </div>

                {loading ? (
                    <div className="tasks-loading">
                        <div className="loading-spinner"></div>
                        <p>Carregando tarefas...</p>
                    </div>
                ) : todayTasks && todayTasks.length > 0 ? (
                    <div className="tasks-list">
                        {todayTasks.map((task) => (
                            <TaskCard
                                key={task.id}
                                task={task}
                                onClick={handleTaskClick}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="empty-state">
                        <div className="empty-icon">🎉</div>
                        <p>Nenhuma tarefa para hoje!</p>
                    </div>
                )}
            </div>

            {/* Team Workload */}
            {teamWorkload && teamWorkload.length > 0 && (
                <TeamWorkload
                    teamData={teamWorkload}
                    onMemberClick={handleMemberClick}
                />
            )}

            {/* Quick Actions FAB */}
            <div className="quick-actions">
                <button
                    className="fab"
                    aria-label="Nova Tarefa"
                    onClick={() => console.log('Nova tarefa')}
                >
                    +
                </button>
            </div>
        </div>
    );
};

export default AdminDashboard;
