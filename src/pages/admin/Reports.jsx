
import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { RefreshCw } from 'lucide-react'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Legend
} from 'recharts'

function Reports() {
    const [loading, setLoading] = useState(true)
    const [metrics, setMetrics] = useState({
        total: 0,
        completed: 0,
        pending: 0,
        overdue: 0,
        byStatus: [],
        byPriority: []
    })

    useEffect(() => {
        fetchMetrics()
    }, [])

    async function fetchMetrics() {
        try {
            setLoading(true)

            // Fetch all tasks
            const { data: tasks, error } = await supabase
                .from('tarefas')
                .select('*')

            if (error) throw error

            // Calculate Metrics
            const total = tasks.length
            const completed = tasks.filter(t => t.status === 'completed').length
            const pending = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length
            const overdue = tasks.filter(t => t.status === 'overdue').length

            // Prepare Chart Data
            const statusCounts = {
                pending: 0,
                in_progress: 0,
                completed: 0,
                overdue: 0
            }

            const priorityCounts = {
                low: 0,
                medium: 0,
                high: 0,
                urgent: 0
            }

            tasks.forEach(task => {
                if (statusCounts[task.status] !== undefined) statusCounts[task.status]++
                if (priorityCounts[task.priority] !== undefined) priorityCounts[task.priority]++
            })

            const byStatus = [
                { name: 'Pendente', value: statusCounts.pending, color: '#9CA3AF' },
                { name: 'Em Progresso', value: statusCounts.in_progress, color: '#3B82F6' },
                { name: 'Concluída', value: statusCounts.completed, color: '#10B981' },
                { name: 'Atrasada', value: statusCounts.overdue, color: '#EF4444' }
            ].filter(item => item.value > 0)

            const byPriority = [
                { name: 'Baixa', value: priorityCounts.low, color: '#9CA3AF' },
                { name: 'Média', value: priorityCounts.medium, color: '#6B7280' },
                { name: 'Alta', value: priorityCounts.high, color: '#F59E0B' },
                { name: 'Urgente', value: priorityCounts.urgent, color: '#EF4444' }
            ]

            setMetrics({
                total,
                completed,
                pending,
                overdue,
                byStatus,
                byPriority
            })

        } catch (error) {
            console.error('Error fetching reports:', error)
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="animation-fade-in">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                    <div>
                        <h2>Relatórios</h2>
                    </div>
                </div>
                <div className="card loading-card">
                    <p className="loading-text-primary">Gerando análises...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Relatórios</h2>
                </div>
                <button
                    onClick={fetchMetrics}
                    disabled={loading}
                    className="btn btn-primary flex items-center gap-2 shadow-lg shadow-blue-200/50"
                >
                    <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    Atualizar Dados
                </button>
            </div>

            {/* KPI Grid */}
            <div className="dashboard-grid-metrics mb-8">
                <div className="card metric-card">
                    <span className="metric-label">Total de Tarefas</span>
                    <div className="metric-value-primary">{metrics.total}</div>
                </div>
                <div className="card metric-card">
                    <span className="metric-label">Concluídas</span>
                    <div className="metric-value-success">{metrics.completed}</div>
                </div>
                <div className="card metric-card">
                    <span className="metric-label">Pendentes</span>
                    <div className="metric-value">{metrics.pending}</div>
                </div>
                <div className="card metric-card">
                    <span className="metric-label">Atrasadas</span>
                    <div className="metric-value" style={{ color: 'var(--color-danger)' }}>{metrics.overdue}</div>
                </div>
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>

                {/* Status Chart */}
                <div className="card" style={{ padding: '24px', minHeight: '400px' }}>
                    <h3 className="text-lg font-bold mb-6 text-gray-800">Distribuição por Status</h3>
                    <div style={{ width: '100%', height: '300px' }}>
                        <ResponsiveContainer>
                            <PieChart>
                                <Pie
                                    data={metrics.byStatus}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={100}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {metrics.byStatus.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                />
                                <Legend verticalAlign="bottom" height={36} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Priority Chart */}
                <div className="card" style={{ padding: '24px', minHeight: '400px' }}>
                    <h3 className="text-lg font-bold mb-6 text-gray-800">Tarefas por Prioridade</h3>
                    <div style={{ width: '100%', height: '300px' }}>
                        <ResponsiveContainer>
                            <BarChart data={metrics.byPriority}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                <XAxis
                                    dataKey="name"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#6B7280', fontSize: 12 }}
                                    dy={10}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#6B7280', fontSize: 12 }}
                                />
                                <Tooltip
                                    cursor={{ fill: '#F3F4F6' }}
                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                />
                                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                    {metrics.byPriority.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Reports
