import { createElement, useCallback, useEffect, useState } from 'react'
import { BarChart3, Building2, Users } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../services/supabase'
import { resolveOperationalClienteId } from '../../services/visualTitleGroups'
import '../../styles/adminReports.css'

const RANGES = ['7d', '30d', '90d', 'all']

function reportStart(range, now) {
    if (range === 'all') return new Date(0)
    const start = new Date(now)
    start.setDate(start.getDate() - Number(range.replace('d', '')))
    return start
}

function formatDate(value) {
    if (!value) return 'Sem atividade registrada'
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(new Date(value))
}

export default function Reports() {
    const [activeTab, setActiveTab] = useState('clients')
    const [dateRange, setDateRange] = useState('30d')
    const [clienteId, setClienteId] = useState(null)
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState([])
    const [legacyUnattributed, setLegacyUnattributed] = useState(0)

    useEffect(() => {
        let active = true
        resolveOperationalClienteId(supabase)
            .then(id => { if (active) setClienteId(id) })
            .catch(() => { if (active) toast.error('Não foi possível identificar o cliente operacional.') })
        return () => { active = false }
    }, [])

    const fetchReports = useCallback(async () => {
        if (activeTab === 'staff' && !clienteId) return
        setLoading(true)
        const now = new Date()
        const start = reportStart(dateRange, now)
        try {
            if (activeTab === 'clients') {
                const { data: result, error } = await supabase.rpc('get_client_stats', {
                    start_date: dateRange === 'all' ? null : start.toISOString(),
                    end_date: now.toISOString(),
                })
                if (error) throw error
                setData(result || [])
                setLegacyUnattributed(0)
            } else {
                const { data: result, error } = await supabase.schema('ap').rpc('get_staff_productivity_report', {
                    p_cliente_id: clienteId,
                    p_start: start.toISOString(),
                    p_end: now.toISOString(),
                    p_timezone: 'America/Sao_Paulo',
                })
                if (error) throw error
                setData(result?.staff || [])
                setLegacyUnattributed(Number(result?.legacy_unattributed_os || 0))
            }
        } catch (error) {
            console.error('[Reports] load failed', error)
            setData([])
            toast.error('Erro ao carregar os relatórios operacionais.')
        } finally {
            setLoading(false)
        }
    }, [activeTab, clienteId, dateRange])

    useEffect(() => {
        const timer = window.setTimeout(() => { void fetchReports() }, 0)
        return () => window.clearTimeout(timer)
    }, [fetchReports])

    return (
        <div className="reports-container">
            <div className="reports-header">
                <div className="reports-title">
                    <h1>Relatórios Operacionais</h1>
                    <p>OS concluídas, trabalho em andamento e produção diária de matérias.</p>
                </div>
                <div className="date-range-picker">
                    {RANGES.map(range => (
                        <button key={range} onClick={() => setDateRange(range)} className={`date-range-btn ${dateRange === range ? 'active' : ''}`}>
                            {range === 'all' ? 'Tudo' : `Últimos ${range.replace('d', ' dias')}`}
                        </button>
                    ))}
                </div>
            </div>

            <div className="reports-tabs">
                <TabButton active={activeTab === 'clients'} onClick={() => setActiveTab('clients')} icon={Building2} label="Por Cliente" />
                <TabButton active={activeTab === 'staff'} onClick={() => setActiveTab('staff')} icon={Users} label="Por Colaborador" />
            </div>

            {activeTab === 'staff' && legacyUnattributed > 0 && (
                <div className="reports-attribution-warning">
                    {legacyUnattributed} OS concluídas no período são anteriores ao novo registro de autoria e não foram atribuídas a uma pessoa.
                </div>
            )}

            {loading ? (
                <div className="reports-loading"><div className="loading-spinner" /></div>
            ) : data.length === 0 ? (
                <div className="reports-empty"><BarChart3 className="empty-icon" size={48} /><p>Sem dados para o período selecionado.</p></div>
            ) : (
                <div className="reports-content">
                    {activeTab === 'clients' ? <ClientsTable data={data} /> : <StaffTable data={data} />}
                </div>
            )}
        </div>
    )
}

function TabButton({ active, onClick, icon, label }) {
    return <button onClick={onClick} className={`tab-btn ${active ? 'active' : ''}`}>{createElement(icon, { size: 18 })}{label}</button>
}

function ClientsTable({ data }) {
    return (
        <div className="reports-table-container">
            <table className="reports-table">
                <thead><tr><th>Cliente</th><th className="align-center">Total Tarefas</th><th className="align-center">Concluídas</th><th className="align-center">Atrasadas</th><th className="align-right">Tempo Médio (h)</th></tr></thead>
                <tbody>{data.map(row => (
                    <tr key={row.client_id}>
                        <td>{row.client_name}</td>
                        <td className="align-center">{row.total_tasks}</td>
                        <td className="align-center"><span className={row.completed_tasks > 0 ? 'badge-success' : 'badge-neutral'}>{row.completed_tasks || 0}</span></td>
                        <td className="align-center"><span className={row.overdue_tasks > 0 ? 'badge-error' : 'badge-neutral'}>{row.overdue_tasks || '-'}</span></td>
                        <td className="align-right">{row.avg_resolution_time_hours}h</td>
                    </tr>
                ))}</tbody>
            </table>
        </div>
    )
}

function StaffTable({ data }) {
    return (
        <div className="reports-table-container">
            <table className="reports-table reports-staff-table">
                <thead>
                    <tr>
                        <th>Colaborador</th>
                        <th className="align-center">OS em andamento</th>
                        <th className="align-center">OS concluídas</th>
                        <th className="align-center">Matérias hoje</th>
                        <th className="align-center">Matérias no período</th>
                        <th>Produção por dia</th>
                        <th>Última atividade</th>
                    </tr>
                </thead>
                <tbody>{data.map(row => (
                    <tr key={row.staff_id}>
                        <td>
                            <strong>{row.staff_name}</strong>
                            <span className="reports-staff-work">{row.articles_adopted || 0} adotadas · {row.articles_in_production || 0} em produção</span>
                        </td>
                        <td className="align-center">{row.os_in_progress || 0}</td>
                        <td className="align-center"><span className={row.os_completed > 0 ? 'badge-success' : 'badge-neutral'}>{row.os_completed || 0}</span></td>
                        <td className="align-center">{row.articles_today || 0}</td>
                        <td className="align-center"><span className={row.articles_completed > 0 ? 'badge-success' : 'badge-neutral'}>{row.articles_completed || 0}</span></td>
                        <td><DailyArticles items={row.daily_articles || []} /></td>
                        <td>{formatDate(row.last_activity)}</td>
                    </tr>
                ))}</tbody>
            </table>
        </div>
    )
}

function DailyArticles({ items }) {
    if (!items.length) return <span className="badge-neutral">Sem produção</span>
    return (
        <div className="reports-daily-list">
            {items.map(item => <span key={item.date}>{new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}: <strong>{item.count}</strong></span>)}
        </div>
    )
}
