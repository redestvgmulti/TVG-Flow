import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, Users, Building2, Activity, CheckCircle } from 'lucide-react'
import '../../styles/super-admin-dashboard.css'

export default function ReportsPage() {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [stats, setStats] = useState({
        totalCompanies: 0,
        totalUsers: 0,
        totalTasks: 0,
        completedTasks: 0
    })
    const [companyGrowth, setCompanyGrowth] = useState([])
    const [taskMetrics, setTaskMetrics] = useState([])

    useEffect(() => {
        fetchReportsData()
    }, [])

    async function fetchReportsData() {
        try {
            setLoading(true)
            setError(null)

            // Fetch companies stats
            const { data: companies, error: companiesError } = await supabase.rpc('get_companies_stats')
            if (companiesError) throw companiesError

            // Fetch all users
            const { data: users, error: usersError } = await supabase
                .from('profissionais')
                .select('id, created_at')
            if (usersError) throw usersError

            // Fetch all tasks
            const { data: tasks, error: tasksError } = await supabase
                .from('tarefas')
                .select('id, status, created_at')
            if (tasksError) throw tasksError

            // Calculate stats
            const totalCompanies = companies?.length || 0
            const totalUsers = users?.length || 0
            const totalTasks = tasks?.length || 0
            const completedTasks = tasks?.filter(t => t.status === 'completed' || t.status === 'concluida').length || 0

            setStats({
                totalCompanies,
                totalUsers,
                totalTasks,
                completedTasks
            })

            // Company growth over last 30 days
            const growthData = getLast30Days().map(date => {
                const count = companies?.filter(c => {
                    const createdDate = new Date(c.created_at).toDateString()
                    return new Date(createdDate) <= date
                }).length || 0
                return {
                    date: date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
                    companies: count
                }
            })
            setCompanyGrowth(growthData)

            // Task metrics by company
            const tasksByCompany = companies?.map(company => ({
                name: company.nome?.substring(0, 15) || 'N/A',
                tasks: tasks?.filter(t => t.empresa_id === company.id).length || 0,
                completed: tasks?.filter(t => t.empresa_id === company.id && (t.status === 'completed' || t.status === 'concluida')).length || 0
            })) || []
            setTaskMetrics(tasksByCompany.slice(0, 5)) // Top 5 companies

        } catch (error) {
            console.error('Error fetching reports data:', error)
            setError(error.message)
        } finally {
            setLoading(false)
        }
    }

    function getLast30Days() {
        const days = []
        for (let i = 29; i >= 0; i--) {
            const date = new Date()
            date.setDate(date.getDate() - i)
            days.push(date)
        }
        return days
    }

    if (loading) {
        return (
            <div className="dashboard-container">
                <div className="dashboard-header">
                    <h2>Relatórios</h2>
                </div>
                <div className="card loading-card">
                    <p className="loading-text-primary">Carregando relatórios...</p>
                    <div className="spinner"></div>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="dashboard-container">
                <div className="dashboard-header">
                    <h2>Relatórios</h2>
                </div>
                <div className="error-state card">
                    <p>Erro ao carregar dados: {error}</p>
                    <button onClick={fetchReportsData} className="btn btn-primary">Tentar Novamente</button>
                </div>
            </div>
        )
    }

    return (
        <div className="dashboard-container animation-fade-in">
            <div className="dashboard-header">
                <h2>Relatórios</h2>
            </div>

            {/* KPI Cards */}
            <div className="dashboard-grid-metrics">
                <div className="card metric-card">
                    <h3 className="metric-label">Total de Empresas</h3>
                    <p className="metric-value">{stats.totalCompanies}</p>
                </div>

                <div className="card metric-card">
                    <h3 className="metric-label">Total de Usuários</h3>
                    <p className="metric-value metric-value-primary">{stats.totalUsers}</p>
                </div>

                <div className="card metric-card">
                    <h3 className="metric-label">Total de Tarefas</h3>
                    <p className="metric-value">{stats.totalTasks}</p>
                </div>

                <div className="card metric-card">
                    <h3 className="metric-label">Taxa de Conclusão</h3>
                    <p className="metric-value metric-value-success">
                        {stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0}%
                    </p>
                </div>
            </div>

            {/* Charts Row */}
            <div className="dashboard-grid-charts">
                {/* Company Growth Chart */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title flex items-center gap-2">
                            <TrendingUp size={18} className="text-primary" />
                            Crescimento de Empresas (30 dias)
                        </h3>
                    </div>
                    {companyGrowth.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={companyGrowth}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 11, fill: '#6B7280' }}
                                    axisLine={false}
                                    tickLine={false}
                                    dy={10}
                                />
                                <YAxis
                                    tick={{ fontSize: 11, fill: '#6B7280' }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: '8px',
                                        border: 'none',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                                    }}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="companies"
                                    stroke="var(--color-primary)"
                                    strokeWidth={3}
                                    dot={{ fill: 'var(--color-primary)', strokeWidth: 2, r: 4, stroke: '#fff' }}
                                    activeDot={{ r: 6 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="empty-state">
                            <span className="empty-icon">📈</span>
                            <p className="empty-text">Sem dados suficientes para exibir o gráfico.</p>
                        </div>
                    )}
                </div>

                {/* Task Metrics by Company */}
                <div className="card">
                    <div className="card-header">
                        <h3 className="card-title flex items-center gap-2">
                            <Activity size={18} className="text-primary" />
                            Tarefas por Empresa (Top 5)
                        </h3>
                    </div>
                    {taskMetrics.length > 0 ? (
                        <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={taskMetrics}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                                <XAxis
                                    dataKey="name"
                                    tick={{ fontSize: 11, fill: '#6B7280' }}
                                    axisLine={false}
                                    tickLine={false}
                                    dy={10}
                                />
                                <YAxis
                                    tick={{ fontSize: 11, fill: '#6B7280' }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: '8px',
                                        border: 'none',
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                                    }}
                                />
                                <Bar dataKey="tasks" fill="var(--color-primary)" radius={[8, 8, 0, 0]} />
                                <Bar dataKey="completed" fill="#10b981" radius={[8, 8, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="empty-state">
                            <span className="empty-icon">📊</span>
                            <p className="empty-text">Sem dados de tarefas disponíveis.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Summary Card */}
            <div className="card mt-6">
                <div className="card-header">
                    <h3 className="card-title flex items-center gap-2">
                        <CheckCircle size={18} className="text-primary" />
                        Resumo Geral
                    </h3>
                </div>
                <div className="activity-list p-4">
                    <div className="activity-item p-3 rounded bg-subtle flex items-center gap-3">
                        <div className="activity-icon bg-white p-2 rounded shadow-sm">
                            <Building2 size={20} className="text-primary" />
                        </div>
                        <div className="activity-content">
                            <p className="font-medium m-0 text-primary">
                                {stats.totalCompanies} empresa(s) gerando {stats.totalTasks} tarefa(s)
                            </p>
                            <span className="text-sm text-secondary">
                                {stats.completedTasks} tarefas concluídas ({stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0}% de taxa de conclusão)
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
