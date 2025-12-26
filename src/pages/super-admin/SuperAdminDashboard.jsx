import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { Building2, Users, Ban, Activity } from 'lucide-react'
import '../../styles/super-admin-dashboard.css'

export default function SuperAdminDashboard() {
    const [companies, setCompanies] = useState([])
    const [stats, setStats] = useState({
        totalCompanies: 0,
        activeCompanies: 0,
        suspendedCompanies: 0,
        totalUsers: 0
    })
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    useEffect(() => {
        fetchDashboardStats()
    }, [])

    async function fetchDashboardStats() {
        try {
            setLoading(true)
            setError(null)

            const { data, error: rpcError } = await supabase.rpc('get_companies_stats')

            if (rpcError) {
                console.error('RPC Error:', rpcError)
                throw rpcError
            }

            console.log('Companies data:', data)
            setCompanies(data || [])

            if (data && data.length > 0) {
                const totalCompanies = data.length
                const activeCompanies = data.filter(c => c.status_conta === 'active').length
                const suspendedCompanies = data.filter(c => c.status_conta === 'suspended').length
                const totalUsers = data.reduce((sum, c) => sum + Number(c.users_count || 0), 0)

                setStats({
                    totalCompanies,
                    activeCompanies,
                    suspendedCompanies,
                    totalUsers
                })
            }
        } catch (error) {
            console.error('Error fetching dashboard stats:', error)
            setError(error.message)
        } finally {
            setLoading(false)
        }
    }

    const kpis = [
        { label: 'Total de Empresas', value: stats.totalCompanies, icon: Building2, color: '#3b82f6' },
        { label: 'Empresas Ativas', value: stats.activeCompanies, icon: Activity, color: '#10b981' },
        { label: 'Empresas Suspensas', value: stats.suspendedCompanies, icon: Ban, color: '#ef4444' },
        { label: 'Usuários Totais', value: stats.totalUsers, icon: Users, color: '#8b5cf6' },
    ]

    if (loading) {
        return (
            <div className="dashboard-container">
                <div className="dashboard-header">
                    <h2>Painel Super Admin</h2>
                </div>
                <div className="card loading-card">
                    <p className="loading-text-primary">Carregando métricas...</p>
                    <div className="spinner"></div>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="dashboard-container">
                <div className="dashboard-header">
                    <h2>Painel Super Admin</h2>
                </div>
                <div className="error-state card">
                    <p>Erro ao carregar dados: {error}</p>
                    <button onClick={fetchDashboardStats} className="btn btn-primary">Tentar Novamente</button>
                </div>
            </div>
        )
    }

    return (
        <div className="dashboard-container animation-fade-in">
            <div className="dashboard-header">
                <h2>Painel Super Admin</h2>
            </div>

            {/* KPI Cards - Using standard 'metric-card' structure from Admin Dashboard */}
            <div className="dashboard-grid-metrics">
                <div className="card metric-card">
                    <h3 className="metric-label">Total de Empresas</h3>
                    <p className="metric-value">{stats.totalCompanies}</p>
                </div>

                <div className="card metric-card">
                    <h3 className="metric-label">Empresas Ativas</h3>
                    <p className="metric-value metric-value-success">{stats.activeCompanies}</p>
                </div>

                <div className="card metric-card">
                    <h3 className="metric-label">Empresas Suspensas</h3>
                    <p className="metric-value metric-value-danger">{stats.suspendedCompanies}</p>
                </div>

                <div className="card metric-card">
                    <h3 className="metric-label">Usuários Totais</h3>
                    <p className="metric-value">{stats.totalUsers}</p>
                </div>
            </div>

            {/* Activity Block - Styled as a standard card */}
            <div className="card mt-6">
                <div className="card-header">
                    <h3 className="card-title flex items-center gap-2">
                        <Activity size={18} className="text-primary" />
                        Atividade Recente
                    </h3>
                </div>

                <div className="activity-list p-4">
                    {companies.length > 0 ? (
                        <div className="activity-item p-3 rounded bg-subtle flex items-center gap-3">
                            <div className="activity-icon bg-white p-2 rounded shadow-sm">
                                <Building2 size={20} className="text-primary" />
                            </div>
                            <div className="activity-content">
                                <p className="font-medium m-0 text-primary">
                                    {companies.filter(c => c.status_conta === 'active').length} empresa(s) ativa(s) no sistema
                                </p>
                                <span className="text-sm text-secondary">
                                    Última atualização: agora
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div className="activity-empty text-center p-8 text-secondary">
                            <p>Nenhuma empresa cadastrada ainda</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

