import React, { useState, useEffect } from 'react';
import { getAllTasks } from '../../services/taskService';
import { PieChart, BarChart, TrendingUp, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import './Relatorios.css';

const Relatorios = () => {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [metrics, setMetrics] = useState({
        total: 0,
        completed: 0,
        pending: 0,
        overdue: 0,
        byProfessional: {},
        byDepartment: {},
        byClient: {}
    });

    const fetchData = async () => {
        setLoading(true);
        try {
            const data = await getAllTasks();
            setTasks(data);
            calculateMetrics(data);
        } catch (error) {
            console.error('Erro ao carregar dados:', error);
        } finally {
            setLoading(false);
        }
    };

    const calculateMetrics = (data) => {
        const now = new Date();
        const stats = {
            total: data.length,
            completed: 0,
            pending: 0,
            overdue: 0,
            byProfessional: {},
            byDepartment: {},
            byClient: {}
        };

        data.forEach(task => {
            // Status counts
            if (task.status === 'concluida') stats.completed++;
            else stats.pending++;

            // Overdue check (if not completed)
            if (task.status !== 'concluida' && new Date(task.deadline) < now) {
                stats.overdue++;
            }

            // By Professional
            const profName = task.profissionais?.nome || 'Não atribuído';
            stats.byProfessional[profName] = (stats.byProfessional[profName] || 0) + 1;

            // By Department
            const deptName = task.departamentos?.nome || 'Sem departamento';
            stats.byDepartment[deptName] = (stats.byDepartment[deptName] || 0) + 1;

            // By Client
            const clientName = task.clientes?.nome || 'Sem cliente';
            stats.byClient[clientName] = (stats.byClient[clientName] || 0) + 1;
        });

        setMetrics(stats);
    };

    useEffect(() => {
        fetchData();
    }, []);

    const MetricCard = ({ title, value, icon, color, subtext }) => (
        <div className="metric-card">
            <div className="metric-icon" style={{ backgroundColor: `${color}20`, color: color }}>
                {icon}
            </div>
            <div className="metric-content">
                <p className="metric-title">{title}</p>
                <h3 className="metric-value">{value}</h3>
                {subtext && <p className="metric-subtext">{subtext}</p>}
            </div>
        </div>
    );

    const DistributionList = ({ title, data }) => (
        <div className="distribution-card">
            <h3>{title}</h3>
            <div className="distribution-list">
                {Object.entries(data)
                    .sort(([, a], [, b]) => b - a)
                    .map(([key, value]) => (
                        <div key={key} className="distribution-item">
                            <span className="dist-label">{key}</span>
                            <div className="dist-bar-container">
                                <div
                                    className="dist-bar"
                                ></div>
                            </div>
                            <span className="dist-value">{value}</span>
                        </div>
                    ))}
            </div>
        </div>
    );

    return (
        <div className="page-container">
            <div className="page-header">
                <h1>Relatórios e Métricas</h1>
                <button className="btn-secondary" onClick={fetchData}>Atualizar</button>
            </div>

            {loading ? (
                <div className="loading">Carregando métricas...</div>
            ) : (
                <>
                    <div className="metrics-grid">
                        <MetricCard
                            title="Total de Tarefas"
                            value={metrics.total}
                            icon={<TrendingUp size={24} />}
                            color="#2563eb"
                        />
                        <MetricCard
                            title="Concluídas"
                            value={metrics.completed}
                            icon={<CheckCircle size={24} />}
                            color="#10b981"
                            subtext={`${((metrics.completed / metrics.total) * 100 || 0).toFixed(1)}% do total`}
                        />
                        <MetricCard
                            title="Pendentes"
                            value={metrics.pending}
                            icon={<Clock size={24} />}
                            color="#f59e0b"
                        />
                        <MetricCard
                            title="Atrasadas"
                            value={metrics.overdue}
                            icon={<AlertTriangle size={24} />}
                            color="#ef4444"
                            subtext="Atenção necessária"
                        />
                    </div>

                    <div className="charts-grid">
                        <DistributionList title="Tarefas por Profissional" data={metrics.byProfessional} />
                        <DistributionList title="Tarefas por Departamento" data={metrics.byDepartment} />
                        <DistributionList title="Tarefas por Cliente" data={metrics.byClient} />
                    </div>
                </>
            )}
        </div>
    );
};

export default Relatorios;
