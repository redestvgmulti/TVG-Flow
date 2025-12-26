import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import {
    BarChart3,
    Users,
    Briefcase,
    Building2,
} from 'lucide-react'
import { toast } from 'sonner'
import '../../styles/adminReports.css' // Import custom stylesheet

export default function Reports() {
    const [activeTab, setActiveTab] = useState('clients') // clients, roles, staff
    const [dateRange, setDateRange] = useState('30d') // 7d, 30d, 90d, all
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState([])

    useEffect(() => {
        fetchReports()
    }, [activeTab, dateRange])

    async function fetchReports() {
        try {
            setLoading(true)

            // Calculate Dates
            const now = new Date()
            let startDate = new Date()

            if (dateRange === '7d') startDate.setDate(now.getDate() - 7)
            if (dateRange === '30d') startDate.setDate(now.getDate() - 30)
            if (dateRange === '90d') startDate.setDate(now.getDate() - 90)
            if (dateRange === 'all') startDate = null

            const rpcName =
                activeTab === 'clients' ? 'get_client_stats' :
                    activeTab === 'roles' ? 'get_role_stats' :
                        'get_staff_stats'

            // NOTE: Parameter order matches the SQL definition: get_client_stats(start_date, end_date)
            const { data: result, error } = await supabase.rpc(rpcName, {
                start_date: startDate?.toISOString(),
                end_date: now.toISOString()
            })

            if (error) throw error
            setData(result || [])

        } catch (error) {
            console.error('Error fetching reports:', error)
            toast.error('Erro ao carregar dados. Verifique se as migrations foram aplicadas.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="reports-container">
            {/* Header */}
            <div className="reports-header">
                <div className="reports-title">
                    <h1>Relatórios Operacionais</h1>
                    <p>Visão geral de performance e volumetria.</p>
                </div>

                {/* Date Controls */}
                <div className="date-range-picker">
                    {['7d', '30d', '90d', 'all'].map(range => (
                        <button
                            key={range}
                            onClick={() => setDateRange(range)}
                            className={`date-range-btn ${dateRange === range ? 'active' : ''}`}
                        >
                            {range === 'all' ? 'Tudo' : `Ultimos ${range.replace('d', ' dias')}`}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tabs */}
            <div className="reports-tabs">
                <TabButton
                    active={activeTab === 'clients'}
                    onClick={() => setActiveTab('clients')}
                    icon={Building2}
                    label="Por Cliente"
                />
                <TabButton
                    active={activeTab === 'staff'}
                    onClick={() => setActiveTab('staff')}
                    icon={Users}
                    label="Por Colaborador"
                />
            </div>

            {/* Content */}
            {loading ? (
                <div className="reports-loading">
                    <div className="loading-spinner"></div>
                </div>
            ) : data.length === 0 ? (
                <div className="reports-empty">
                    <BarChart3 className="empty-icon" size={48} />
                    <p>Sem dados para o período selecionado.</p>
                </div>
            ) : (
                <div className="reports-content">
                    {activeTab === 'clients' && <ClientsTable data={data} />}
                    {activeTab === 'staff' && <StaffTable data={data} />}
                </div>
            )}
        </div>
    )
}

function TabButton({ active, onClick, icon: Icon, label }) {
    return (
        <button
            onClick={onClick}
            className={`tab-btn ${active ? 'active' : ''}`}
        >
            <Icon size={18} />
            {label}
        </button>
    )
}

function ClientsTable({ data }) {
    return (
        <div className="reports-table-container">
            <table className="reports-table">
                <thead>
                    <tr>
                        <th>Cliente</th>
                        <th className="align-center">Total Tarefas</th>
                        <th className="align-center">Concluídas</th>
                        <th className="align-center">Atrasadas</th>
                        <th className="align-right">Tempo Médio (h)</th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((row) => (
                        <tr key={row.client_id}>
                            <td>{row.client_name}</td>
                            <td className="align-center">{row.total_tasks}</td>
                            <td className="align-center">
                                {row.completed_tasks > 0 ? (
                                    <span className="badge-success">{row.completed_tasks}</span>
                                ) : (
                                    <span className="badge-neutral">0</span>
                                )}
                            </td>
                            <td className="align-center">
                                {row.overdue_tasks > 0 ? (
                                    <span className="badge-error">{row.overdue_tasks}</span>
                                ) : (
                                    <span className="badge-neutral">-</span>
                                )}
                            </td>
                            <td className="align-right">{row.avg_resolution_time_hours}h</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

function StaffTable({ data }) {
    return (
        <div className="reports-table-container">
            <table className="reports-table">
                <thead>
                    <tr>
                        <th>Colaborador</th>
                        <th className="align-center">Atribuídas</th>
                        <th className="align-center">Entregues</th>
                        <th className="align-center">Atrasos</th>
                        <th className="align-right">Eficiência</th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((row) => (
                        <tr key={row.staff_id}>
                            <td>{row.staff_name}</td>
                            <td className="align-center">{row.total_assigned}</td>
                            <td className="align-center">
                                {row.completed_count > 0 ? (
                                    <span className="badge-success">{row.completed_count}</span>
                                ) : (
                                    <span className="badge-neutral">0</span>
                                )}
                            </td>
                            <td className="align-center">
                                {row.overdue_count > 0 ? (
                                    <span className="badge-error">{row.overdue_count}</span>
                                ) : (
                                    <span className="badge-neutral">-</span>
                                )}
                            </td>
                            <td className="align-right">
                                <div className="efficiency-wrapper">
                                    <span className={`efficiency-score ${row.efficiency_score >= 80 ? 'score-high' : row.efficiency_score >= 50 ? 'score-mid' : 'score-low'}`}>
                                        {row.efficiency_score}%
                                    </span>
                                    <div className="progress-track">
                                        <div
                                            className={`progress-fill ${row.efficiency_score >= 80 ? 'fill-high' : row.efficiency_score >= 50 ? 'fill-mid' : 'fill-low'}`}
                                            style={{ width: `${row.efficiency_score}%` }}
                                        ></div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
