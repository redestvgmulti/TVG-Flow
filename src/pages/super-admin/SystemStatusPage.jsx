import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { Database, Activity, RefreshCw, CheckCircle, AlertCircle, Users } from 'lucide-react'
import '../../styles/super-admin-dashboard.css'
import '../../styles/utilities.css'

export default function SystemStatusPage() {
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [systemHealth, setSystemHealth] = useState({
        database: { status: 'unknown', responseTime: 0 },
        activeUsers: 0,
        lastCheck: null
    })

    useEffect(() => {
        checkSystemHealth()
    }, [])

    async function checkSystemHealth() {
        try {
            setRefreshing(true)

            // 1. Database Health Check - Measure real latency
            const start = performance.now()
            const { error: dbError } = await supabase
                .from('empresas')
                .select('id')
                .limit(1)
            const responseTime = Math.round(performance.now() - start)

            let dbStatus = 'healthy'
            if (dbError) {
                dbStatus = 'error'
            } else if (responseTime > 800) {
                dbStatus = 'error'
            } else if (responseTime > 300) {
                dbStatus = 'warning'
            }

            // 2. Active Users (last 15 minutes)
            const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()
            const { count: activeUsers, error: usersError } = await supabase
                .from('profissionais')
                .select('id', { count: 'exact', head: true })
                .eq('ativo', true)
                .gt('last_activity_at', fifteenMinutesAgo)

            setSystemHealth({
                database: { status: dbStatus, responseTime },
                activeUsers: usersError ? 0 : (activeUsers || 0),
                lastCheck: new Date()
            })

        } catch (error) {
            console.error('Error checking system health:', error)
            setSystemHealth(prev => ({
                ...prev,
                database: { status: 'error', responseTime: 0 },
                lastCheck: new Date()
            }))
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }

    function getStatusColor(status) {
        switch (status) {
            case 'healthy': return '#10b981'
            case 'warning': return '#f59e0b'
            case 'error': return '#ef4444'
            default: return '#6b7280'
        }
    }

    function getStatusIcon(status) {
        switch (status) {
            case 'healthy': return <CheckCircle size={20} style={{ color: '#10b981' }} />
            case 'warning': return <AlertCircle size={20} style={{ color: '#f59e0b' }} />
            case 'error': return <AlertCircle size={20} style={{ color: '#ef4444' }} />
            default: return <Activity size={20} style={{ color: '#6b7280' }} />
        }
    }

    function getStatusText(status) {
        switch (status) {
            case 'healthy': return 'Saudável'
            case 'warning': return 'Lento'
            case 'error': return 'Erro'
            default: return 'Desconhecido'
        }
    }

    if (loading) {
        return (
            <div className="dashboard-container">
                <div className="dashboard-header">
                    <h2>Status do Sistema</h2>
                </div>
                <div className="card loading-card">
                    <p className="loading-text-primary">Verificando status...</p>
                    <div className="spinner"></div>
                </div>
            </div>
        )
    }

    return (
        <div className="dashboard-container animation-fade-in">
            <div className="dashboard-header flex justify-between items-center">
                <h2>Status do Sistema</h2>
                <button
                    onClick={checkSystemHealth}
                    disabled={refreshing}
                    className="btn-refresh"
                >
                    <RefreshCw size={16} style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }} />
                    Atualizar Status
                </button>
            </div>

            {/* Status Cards */}
            <div className="dashboard-grid-metrics">
                {/* Database Status */}
                <div className="card metric-card">
                    <div className="flex items-center gap-2 mb-3">
                        <Database size={18} style={{ color: getStatusColor(systemHealth.database.status) }} />
                        <h3 className="metric-label m-0">Banco de Dados</h3>
                    </div>
                    <div className="flex items-center gap-2">
                        {getStatusIcon(systemHealth.database.status)}
                        <p className="metric-value" style={{ fontSize: '18px', color: getStatusColor(systemHealth.database.status) }}>
                            {getStatusText(systemHealth.database.status)}
                        </p>
                    </div>
                    <p className="text-sm text-tertiary mt-2 m-0">
                        Resposta: {systemHealth.database.responseTime}ms
                    </p>
                </div>

                {/* Active Users */}
                <div className="card metric-card">
                    <div className="flex items-center gap-2 mb-3">
                        <Users size={18} className="text-brand" />
                        <h3 className="metric-label m-0">Usuários Ativos</h3>
                    </div>
                    <p className="metric-value">{systemHealth.activeUsers}</p>
                    <p className="text-sm text-tertiary mt-2 m-0">
                        Últimos 15 minutos
                    </p>
                </div>

                {/* Last Check */}
                <div className="card metric-card">
                    <div className="flex items-center gap-2 mb-3">
                        <RefreshCw size={18} className="text-brand" />
                        <h3 className="metric-label m-0">Última Verificação</h3>
                    </div>
                    <p className="metric-value" style={{ fontSize: '16px' }}>
                        {systemHealth.lastCheck?.toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                        })}
                    </p>
                    <p className="text-sm text-tertiary mt-2 m-0">
                        {systemHealth.lastCheck?.toLocaleDateString('pt-BR')}
                    </p>
                </div>
            </div>

            {/* System Summary */}
            <div className="card mt-6">
                <div className="card-header">
                    <h3 className="card-title flex items-center gap-2">
                        <Activity size={18} className="text-primary" />
                        Resumo do Sistema
                    </h3>
                </div>
                <div className="activity-list p-4">
                    <div className="activity-item p-3 rounded bg-subtle flex items-center gap-3">
                        <div className="activity-icon bg-white p-2 rounded shadow-sm">
                            {getStatusIcon(systemHealth.database.status)}
                        </div>
                        <div className="activity-content">
                            <p className="font-medium m-0 text-primary">
                                Sistema {systemHealth.database.status === 'healthy' ? 'operando normalmente' : 'com problemas'}
                            </p>
                            <span className="text-sm text-secondary">
                                {systemHealth.database.status === 'healthy'
                                    ? 'Todos os serviços estão funcionando corretamente'
                                    : 'Alguns serviços podem estar com problemas'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Performance Metrics */}
            <div className="card mt-6">
                <div className="card-header">
                    <h3 className="card-title flex items-center gap-2">
                        <Database size={18} className="text-primary" />
                        Métricas de Performance
                    </h3>
                </div>
                <div className="p-4">
                    <div className="grid gap-3">
                        <div className="performance-metric-row">
                            <span className="text-sm font-medium text-secondary">
                                Tempo de Resposta do Banco
                            </span>
                            <span style={{
                                fontSize: '14px',
                                fontWeight: '600',
                                color: systemHealth.database.responseTime < 300 ? '#10b981' : systemHealth.database.responseTime < 800 ? '#f59e0b' : '#ef4444'
                            }}>
                                {systemHealth.database.responseTime}ms
                            </span>
                        </div>
                        <div className="performance-metric-row">
                            <span className="text-sm font-medium text-secondary">
                                Status da Conexão
                            </span>
                            <span style={{
                                fontSize: '14px',
                                fontWeight: '600',
                                color: getStatusColor(systemHealth.database.status)
                            }}>
                                {getStatusText(systemHealth.database.status)}
                            </span>
                        </div>
                        <div className="performance-metric-row">
                            <span className="text-sm font-medium text-secondary">
                                Usuários Ativos
                            </span>
                            <span className="text-sm font-semibold text-brand">
                                {systemHealth.activeUsers} usuários
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
