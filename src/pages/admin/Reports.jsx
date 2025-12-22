import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { RefreshCw, BarChart3 } from 'lucide-react'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell
} from 'recharts'
import '../../styles/adminReports.css'

function Reports() {
    const [loading, setLoading] = useState(true)
    const [metrics, setMetrics] = useState({
        total: 0,
        completed: 0,
        pending: 0,
        overdue: 0,
        byDepartment: [],
        overdueByDepartment: [],
        byPriority: []
    })

    useEffect(() => {
        fetchMetrics()
    }, [])

    async function fetchMetrics() {
        try {
            setLoading(true)

            // Fetch all tasks with department info
            const { data: tasks, error: tasksError } = await supabase
                .from('tarefas')
                .select(`
                    *,
                    areas (
                        id,
                        nome
                    )
                `)

            if (tasksError) throw tasksError

            // Fetch all active departments
            const { data: departments, error: deptsError } = await supabase
                .from('areas')
                .select('id, nome')
                .eq('ativo', true)
                .order('nome')

            if (deptsError) throw deptsError

            const now = new Date()

            // Calculate basic metrics with correct overdue logic
            const total = tasks.length
            const completed = tasks.filter(t => t.status === 'completed').length
            const pending = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length

            // Correct overdue calculation: deadline passed AND not completed
            const overdue = tasks.filter(t => {
                if (!t.deadline || t.status === 'completed') return false
                return new Date(t.deadline) < now
            }).length

            // Calculate department metrics
            const departmentCounts = {}
            const overdueCounts = {}

            departments.forEach(dept => {
                departmentCounts[dept.id] = 0
                overdueCounts[dept.id] = 0
            })

            tasks.forEach(task => {
                if (task.departamento_id && departmentCounts[task.departamento_id] !== undefined) {
                    departmentCounts[task.departamento_id]++

                    // Correct overdue logic: deadline passed AND not completed
                    const isOverdue = task.deadline &&
                        new Date(task.deadline) < now &&
                        task.status !== 'completed'

                    if (isOverdue) {
                        overdueCounts[task.departamento_id]++
                    }
                }
            })

            // Transform to chart data - Department workload
            let byDepartment = departments
                .map(dept => ({
                    name: dept.nome,
                    value: departmentCounts[dept.id],
                    color: '#64748b'
                }))
                .filter(item => item.value > 0)
                .sort((a, b) => b.value - a.value)

            // Limit to Top 5 + Others
            if (byDepartment.length > 5) {
                const top5 = byDepartment.slice(0, 5)
                const others = byDepartment.slice(5)
                const othersTotal = others.reduce((sum, item) => sum + item.value, 0)

                byDepartment = [
                    ...top5,
                    { name: 'Outros', value: othersTotal, color: '#9ca3af' }
                ]
            }

            // Transform to chart data - Department delays (only show departments with delays)
            let overdueByDepartment = departments
                .map(dept => ({
                    name: dept.nome,
                    value: overdueCounts[dept.id],
                    color: '#ef4444'
                }))
                .filter(item => item.value > 0)
                .sort((a, b) => b.value - a.value)

            // Limit to Top 5 for delays as well
            if (overdueByDepartment.length > 5) {
                const top5 = overdueByDepartment.slice(0, 5)
                const others = overdueByDepartment.slice(5)
                const othersTotal = others.reduce((sum, item) => sum + item.value, 0)

                overdueByDepartment = [
                    ...top5,
                    { name: 'Outros', value: othersTotal, color: '#ef4444' }
                ]
            }

            // Priority data (keeping existing)
            const priorityCounts = {
                low: 0,
                medium: 0,
                high: 0,
                urgent: 0
            }

            tasks.forEach(task => {
                if (priorityCounts[task.priority] !== undefined) priorityCounts[task.priority]++
            })

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
                byDepartment,
                overdueByDepartment,
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
                <div className="admin-reports-header">
                    <h2 className="admin-reports-title">Relatórios</h2>
                </div>
                <div className="card loading-card">
                    <p className="loading-text-primary">Gerando análises...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in">
            {/* Header */}
            <div className="admin-reports-header">
                <h2 className="admin-reports-title">Relatórios</h2>
                <button
                    onClick={fetchMetrics}
                    disabled={loading}
                    className="btn btn-primary admin-reports-refresh-btn"
                >
                    <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    Atualizar Dados
                </button>
            </div>

            {/* KPI Grid */}
            <div className="admin-reports-kpi-grid">
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
                    <div className="metric-value-danger">{metrics.overdue}</div>
                </div>
            </div>

            {/* Charts Grid */}
            <div className="admin-reports-chart-grid">
                {/* Department Workload Chart */}
                <div className="card admin-reports-chart-card">
                    <h3 className="admin-reports-chart-title">Tarefas por Departamento</h3>
                    {metrics.byDepartment.length > 0 ? (
                        <div className="admin-reports-chart-container">
                            <ResponsiveContainer>
                                <BarChart
                                    data={metrics.byDepartment}
                                    layout="vertical"
                                    margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                                    <XAxis
                                        type="number"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#6B7280', fontSize: 12 }}
                                    />
                                    <YAxis
                                        type="category"
                                        dataKey="name"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#1e293b', fontSize: 13, fontWeight: 500 }}
                                        width={90}
                                    />
                                    <Tooltip
                                        cursor={{ fill: '#F3F4F6' }}
                                        contentStyle={{
                                            borderRadius: '8px',
                                            border: 'none',
                                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                                            fontSize: '13px'
                                        }}
                                    />
                                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                                        {metrics.byDepartment.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    ) : (
                        <div className="admin-reports-empty-state">
                            <div className="admin-reports-empty-icon">
                                <BarChart3 size={48} />
                            </div>
                            <p className="admin-reports-empty-text">
                                Nenhuma tarefa atribuída a departamentos
                            </p>
                        </div>
                    )}
                </div>

                {/* Department Delays Chart - Silent UX */}
                {metrics.overdueByDepartment.length > 0 ? (
                    <div className="card admin-reports-chart-card">
                        <h3 className="admin-reports-chart-title">Atrasos por Departamento</h3>
                        <div className="admin-reports-chart-container">
                            <ResponsiveContainer>
                                <BarChart
                                    data={metrics.overdueByDepartment}
                                    layout="vertical"
                                    margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                                >
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E7EB" />
                                    <XAxis
                                        type="number"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#6B7280', fontSize: 12 }}
                                    />
                                    <YAxis
                                        type="category"
                                        dataKey="name"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#1e293b', fontSize: 13, fontWeight: 500 }}
                                        width={90}
                                    />
                                    <Tooltip
                                        cursor={{ fill: '#F3F4F6' }}
                                        contentStyle={{
                                            borderRadius: '8px',
                                            border: 'none',
                                            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                                            fontSize: '13px'
                                        }}
                                    />
                                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                                        {metrics.overdueByDepartment.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                ) : (
                    <div className="card admin-reports-chart-card admin-reports-success-card">
                        <h3 className="admin-reports-chart-title">Atrasos por Departamento</h3>
                        <div className="admin-reports-empty-state">
                            <div className="admin-reports-success-icon">🎉</div>
                            <p className="admin-reports-empty-text admin-reports-success-text">
                                Nenhum atraso no momento
                            </p>
                            <p className="admin-reports-success-subtitle">
                                Todos os departamentos estão em dia
                            </p>
                        </div>
                    </div>
                )}

                {/* Priority Chart (keeping existing) */}
                <div className="card admin-reports-chart-card">
                    <h3 className="admin-reports-chart-title">Tarefas por Prioridade</h3>
                    <div className="admin-reports-chart-container">
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
                                    contentStyle={{
                                        borderRadius: '8px',
                                        border: 'none',
                                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                                        fontSize: '13px'
                                    }}
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
