import { createElement, useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, CalendarDays, CheckCircle2, ClipboardList, FileText, RefreshCcw, Users } from 'lucide-react'
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

function rangeLabel(range) {
    return range === 'all' ? 'Todo o período' : `Últimos ${range.replace('d', ' dias')}`
}

export default function Reports() {
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
        if (!clienteId) return
        setLoading(true)
        const now = new Date()
        const start = reportStart(dateRange, now)
        try {
            const { data: result, error } = await supabase.schema('ap').rpc('get_staff_productivity_report', {
                p_cliente_id: clienteId,
                p_start: start.toISOString(),
                p_end: now.toISOString(),
                p_timezone: 'America/Sao_Paulo',
            })
            if (error) throw error
            setData(result?.staff || [])
            setLegacyUnattributed(Number(result?.legacy_unattributed_os || 0))
        } catch (error) {
            console.error('[Reports] load failed', error)
            setData([])
            toast.error('Não foi possível carregar os dados da equipe.')
        } finally {
            setLoading(false)
        }
    }, [clienteId, dateRange])

    useEffect(() => {
        const timer = window.setTimeout(() => { void fetchReports() }, 0)
        return () => window.clearTimeout(timer)
    }, [fetchReports])

    const summary = useMemo(() => data.reduce((totals, row) => ({
        staff: totals.staff + 1,
        tasksInProgress: totals.tasksInProgress + Number(row.os_in_progress || 0),
        articlesInProduction: totals.articlesInProduction + Number(row.articles_in_production || 0),
        articlesCompleted: totals.articlesCompleted + Number(row.articles_completed || 0),
        articlesToday: totals.articlesToday + Number(row.articles_today || 0),
    }), { staff: 0, tasksInProgress: 0, articlesInProduction: 0, articlesCompleted: 0, articlesToday: 0 }), [data])

    return (
        <div className="reports-container reports-team-container">
            <div className="reports-header reports-team-header">
                <div className="reports-title reports-team-title">
                    <div className="reports-title-icon"><Users size={20} /></div>
                    <div>
                        <h1>Acompanhamento da equipe</h1>
                        <p>Veja o que cada colaborador está fazendo e o que produziu no período.</p>
                    </div>
                </div>
                <div className="reports-header-actions">
                    <div className="date-range-picker" aria-label="Período do relatório">
                        {RANGES.map(range => (
                            <button key={range} type="button" onClick={() => setDateRange(range)} className={`date-range-btn ${dateRange === range ? 'active' : ''}`}>
                                {range === 'all' ? 'Tudo' : `Últimos ${range.replace('d', ' dias')}`}
                            </button>
                        ))}
                    </div>
                    <button type="button" className="btn btn-secondary reports-refresh" onClick={() => fetchReports()} disabled={loading || !clienteId}>
                        <RefreshCcw size={13} className={loading ? 'ap-spin-icon' : ''} /> Atualizar
                    </button>
                </div>
            </div>

            {legacyUnattributed > 0 && (
                <div className="reports-attribution-warning">
                    {legacyUnattributed} tarefas concluídas neste período são antigas e não têm um responsável registrado.
                </div>
            )}

            {loading ? (
                <div className="reports-loading"><div className="loading-spinner" /><span>Atualizando os dados da equipe…</span></div>
            ) : data.length === 0 ? (
                <div className="reports-empty"><BarChart3 className="empty-icon" size={48} /><p>Nenhum dado da equipe para {rangeLabel(dateRange).toLowerCase()}.</p></div>
            ) : (
                <>
                    <section className="reports-summary" aria-label="Resumo da equipe">
                        <SummaryCard icon={Users} label="Colaboradores" value={summary.staff} helper="Com atividade no cliente" />
                        <SummaryCard icon={ClipboardList} label="Tarefas em andamento" value={summary.tasksInProgress} helper="Aguardando conclusão" />
                        <SummaryCard icon={FileText} label="Matérias produzindo" value={summary.articlesInProduction} helper="Em criação agora" />
                        <SummaryCard icon={CheckCircle2} label="Matérias concluídas" value={summary.articlesCompleted} helper={`${summary.articlesToday} feitas hoje`} accent="success" />
                    </section>

                    <div className="reports-list-heading">
                        <div>
                            <h2>Por colaborador</h2>
                            <p>{summary.staff} pessoas · {rangeLabel(dateRange)}</p>
                        </div>
                    </div>
                    <section className="reports-staff-grid" aria-label="Produção por colaborador">
                        {data.map(row => <StaffCard key={row.staff_id} row={row} />)}
                    </section>
                </>
            )}
        </div>
    )
}

function SummaryCard({ icon: Icon, label, value, helper, accent = 'default' }) {
    return (
        <article className={`reports-summary-card reports-summary-card--${accent}`}>
            <div className="reports-summary-icon">{createElement(Icon, { size: 18 })}</div>
            <div><span>{label}</span><strong>{value}</strong><small>{helper}</small></div>
        </article>
    )
}

function StaffCard({ row }) {
    return (
        <article className="reports-staff-card">
            <header className="reports-staff-card-header">
                <div>
                    <h3>{row.staff_name}</h3>
                    <p>Última atividade: {formatDate(row.last_activity)}</p>
                </div>
                <span className="reports-today-badge">{row.articles_today || 0} hoje</span>
            </header>

            <div className="reports-staff-section">
                <p className="reports-section-label">Trabalho agora</p>
                <div className="reports-metric-grid">
                    <Metric label="Tarefas em andamento" value={row.os_in_progress || 0} />
                    <Metric label="Pautas aguardando início" value={row.articles_adopted || 0} />
                    <Metric label="Matérias produzindo" value={row.articles_in_production || 0} />
                </div>
            </div>

            <div className="reports-staff-section">
                <p className="reports-section-label">Entregas no período</p>
                <div className="reports-metric-grid">
                    <Metric label="Matérias concluídas" value={row.articles_completed || 0} highlight />
                    <Metric label="Tarefas concluídas" value={row.os_completed || 0} />
                    <Metric label="Etapas concluídas" value={row.micro_completed || 0} />
                </div>
            </div>

            <DailyArticles items={row.daily_articles || []} />
        </article>
    )
}

function Metric({ label, value, highlight = false }) {
    return <div className="reports-metric"><span>{label}</span><strong className={highlight ? 'success' : ''}>{value}</strong></div>
}

function DailyArticles({ items }) {
    if (!items.length) return <div className="reports-daily-empty"><CalendarDays size={15} /> Nenhuma matéria concluída neste período.</div>
    const recentItems = items.slice(-7)
    const max = Math.max(...recentItems.map(item => Number(item.count || 0)), 1)
    return (
        <div className="reports-daily-production">
            <div className="reports-daily-heading"><span>Produção recente</span><small>Últimos {recentItems.length} dias com produção</small></div>
            <ul>
                {recentItems.map(item => {
                    const count = Number(item.count || 0)
                    const date = new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                    return <li key={item.date}><time>{date}</time><span className="reports-daily-bar"><i style={{ width: `${Math.max((count / max) * 100, 8)}%` }} /></span><strong>{count}</strong></li>
                })}
            </ul>
        </div>
    )
}
