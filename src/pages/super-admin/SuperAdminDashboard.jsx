import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { Building2, Activity, Ban, TrendingUp, AlertTriangle } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import LoadingScreen from '../../components/LoadingScreen'
import '../../styles/super-admin-dashboard.css'

export default function SuperAdminDashboard() {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    useEffect(() => {
        fetchDashboardData()
    }, [])

    async function fetchDashboardData() {
        try {
            setLoading(true)
            setError(null)

            const { data: response, error: rpcError } = await supabase
                .rpc('get_super_admin_dashboard_stats')

            if (rpcError) {
                console.error('RPC Error:', rpcError)
                throw rpcError
            }


            setData(response)
        } catch (error) {
            console.error('Error fetching dashboard data:', error)
            setError(error.message)
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="super-admin-container">
                <div style={{ height: '70vh', display: 'flex', alignItems: 'center' }}>
                    <LoadingScreen message="Carregando métricas executivas..." />
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="super-admin-container">
                <div className="dashboard-header">
                    <h1>Painel Super Admin</h1>
                    <p className="dashboard-subtitle">Visão Executiva do FlowOS</p>
                </div>
                <div className="error-state card">
                    <p>❌ Erro ao carregar dados: {error}</p>
                    <button onClick={fetchDashboardData} className="btn btn-primary">
                        Tentar Novamente
                    </button>
                </div>
            </div>
        )
    }

    const { metrics, growthData, healthStatus, alerts, summary } = data || {}

    // Health status configuration
    const getHealthConfig = () => {
        if (!healthStatus) return { icon: '🟢', text: 'Saudável', className: 'health-healthy' }

        if (healthStatus.latency < 500) {
            return { icon: '🟢', text: 'Saudável', className: 'health-healthy' }
        } else if (healthStatus.latency < 800) {
            return { icon: '🟡', text: 'Atenção', className: 'health-warning' }
        } else {
            return { icon: '🔴', text: 'Crítico', className: 'health-critical' }
        }
    }

    const healthConfig = getHealthConfig()

    return (
        <div className="super-admin-container">
            {/* Header */}
            <div className="dashboard-header">
                <h1>Painel Super Admin</h1>
                <p className="dashboard-subtitle">Visão Executiva do FlowOS</p>
            </div>

            {/* BLOCO 1: Métricas Principais */}
            <div className="metrics-grid">
                {/* Card 1: Total de Empresas */}
                <div className="metric-card">
                    <div className="metric-icon" style={{ backgroundColor: '#3b82f620' }}>
                        <Building2 size={24} color="#3b82f6" />
                    </div>
                    <div className="metric-content">
                        <h3 className="metric-label">Empresas Ativas no FlowOS</h3>
                        <p className="metric-value">{metrics?.totalTenants || 0}</p>
                        <span className="metric-description">Total de tenants vendidos</span>
                    </div>
                </div>

                {/* Card 2: Empresas Ativas (7 dias) */}
                <div className="metric-card">
                    <div className="metric-icon" style={{ backgroundColor: '#10b98120' }}>
                        <Activity size={24} color="#10b981" />
                    </div>
                    <div className="metric-content">
                        <h3 className="metric-label">Empresas Ativas (Últimos 7 dias)</h3>
                        <p className="metric-value metric-highlight">
                            {metrics?.activeTenants || 0} de {metrics?.totalTenants || 0}
                        </p>
                        <span className="metric-description">
                            {metrics?.activeRatio || 0}% com atividade recente
                        </span>
                    </div>
                </div>

                {/* Card 3: Empresas Suspensas */}
                <div className="metric-card">
                    <div className="metric-icon" style={{ backgroundColor: '#ef444420' }}>
                        <Ban size={24} color="#ef4444" />
                    </div>
                    <div className="metric-content">
                        <h3 className="metric-label">Empresas Suspensas</h3>
                        <p className="metric-value metric-danger">
                            {metrics?.suspendedTenants || 0}
                        </p>
                        <span className="metric-description">Tenants com acesso bloqueado</span>
                    </div>
                </div>

                {/* Card 4: Saúde Geral do Sistema */}
                <div className="metric-card">
                    <div className={`metric-icon ${healthConfig.className}`}>
                        <TrendingUp size={24} />
                    </div>
                    <div className="metric-content">
                        <h3 className="metric-label">Saúde Geral do Sistema</h3>
                        <p className="metric-value">
                            {healthConfig.icon} {healthConfig.text}
                        </p>
                        <span className="metric-description">
                            Latência: {healthStatus?.latency || 0}ms
                        </span>
                    </div>
                </div>
            </div>

            {/* BLOCO 2: Gráfico de Crescimento */}
            <div className="card growth-card">
                <div className="card-header">
                    <h2 className="card-title">
                        <TrendingUp size={20} />
                        Crescimento de Empresas (30 dias)
                    </h2>
                    <p className="card-subtitle">Total acumulado de tenants vendidos</p>
                </div>
                <div className="chart-container">
                    {growthData && growthData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={growthData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                <XAxis
                                    dataKey="date"
                                    stroke="#6b7280"
                                    tickFormatter={(value) => {
                                        const date = new Date(value)
                                        return `${date.getDate()}/${date.getMonth() + 1}`
                                    }}
                                />
                                <YAxis stroke="#6b7280" />
                                <Tooltip
                                    labelFormatter={(value) => {
                                        const date = new Date(value)
                                        return date.toLocaleDateString('pt-BR')
                                    }}
                                    formatter={(value) => [`${value} empresas`, 'Total']}
                                />
                                <Line
                                    type="monotone"
                                    dataKey="total"
                                    stroke="#3b82f6"
                                    strokeWidth={2}
                                    dot={{ fill: '#3b82f6', r: 4 }}
                                    activeDot={{ r: 6 }}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="chart-empty">
                            <p>Sem dados de crescimento disponíveis</p>
                        </div>
                    )}
                </div>
            </div>

            {/* BLOCO 3: Alertas Rápidos */}
            <div className="card alerts-card">
                <div className="card-header">
                    <h2 className="card-title">
                        <AlertTriangle size={20} />
                        Atenções Recentes
                    </h2>
                    <p className="card-subtitle">Resumo de alertas do sistema</p>
                </div>
                <div className="alerts-container">
                    {alerts && (alerts.critical > 0 || alerts.warning > 0) ? (
                        <>
                            {alerts.critical > 0 && (
                                <div className="alert-item alert-critical">
                                    <span className="alert-indicator">🔴</span>
                                    <span className="alert-text">
                                        {alerts.critical} empresa{alerts.critical !== 1 ? 's' : ''} com atenção crítica
                                    </span>
                                </div>
                            )}
                            {alerts.warning > 0 && (
                                <div className="alert-item alert-warning">
                                    <span className="alert-indicator">🟡</span>
                                    <span className="alert-text">
                                        {alerts.warning} empresa{alerts.warning !== 1 ? 's' : ''} com baixa atividade
                                    </span>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="alert-item alert-success">
                            <span className="alert-indicator">🟢</span>
                            <span className="alert-text">Nenhuma atenção necessária no momento</span>
                        </div>
                    )}
                </div>
            </div>

            {/* BLOCO 4: Resumo Executivo */}
            <div className="card summary-card">
                <div className="card-header">
                    <h2 className="card-title">Resumo Executivo</h2>
                </div>
                <div className="summary-content">
                    <p className="summary-text">{summary}</p>
                </div>
            </div>
        </div>
    )
}
