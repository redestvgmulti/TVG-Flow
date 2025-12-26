import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { Shield, Users, Activity, MoreVertical, Ban, CheckCircle, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import '../../styles/super-admin-dashboard.css'

export default function SuperAdminDashboard() {
    const [stats, setStats] = useState([])
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [selectedCompany, setSelectedCompany] = useState(null)
    const [actionNote, setActionNote] = useState('')

    useEffect(() => {
        fetchStats()
    }, [])

    async function fetchStats() {
        try {
            setLoading(true)
            const { data, error } = await supabase.rpc('get_companies_stats')
            if (error) throw error
            setStats(data || [])
        } catch (error) {
            console.error('Error fetching stats:', error)
            toast.error('Erro ao carregar dados do painel')
        } finally {
            setLoading(false)
        }
    }

    /* 
       Dynamic Health Calculation (Redundant if RPC does it, but good for immediate feedback)
       RPC returns: 'healthy', 'low_activity', 'inactive'
    */

    function renderHealthBadge(status) {
        const config = {
            healthy: { color: '#10b981', label: 'Saudável', icon: CheckCircle },
            low_activity: { color: '#f59e0b', label: 'Baixa Ativ.', icon: AlertTriangle },
            inactive: { color: '#ef4444', label: 'Inativo', icon: Ban },
        }
        const current = config[status] || config.inactive
        const Icon = current.icon

        return (
            <span className="badge-health" style={{ color: current.color, borderColor: current.color }}>
                <Icon size={12} />
                {current.label}
            </span>
        )
    }

    function renderAccountStatus(status) {
        if (status === 'suspended') return <span className="badge-status suspended">Suspenso</span>
        if (status === 'trial') return <span className="badge-status trial">Trial</span>
        return <span className="badge-status active">Ativo</span>
    }

    async function handleToggleSuspension() {
        if (!selectedCompany) return

        const newStatus = selectedCompany.status_conta === 'suspended' ? 'active' : 'suspended'

        try {
            const { error } = await supabase
                .from('empresas')
                .update({
                    status_conta: newStatus,
                    internal_notes: selectedCompany.internal_notes ? selectedCompany.internal_notes + '\n' + actionNote : actionNote
                })
                .eq('id', selectedCompany.empresa_id) // RPC returns empresa_id

            if (error) throw error

            toast.success(newStatus === 'suspended' ? 'Empresa suspensa' : 'Empresa reativada')
            setShowModal(false)
            fetchStats()
        } catch (error) {
            console.error('Error updating company:', error)
            toast.error('Erro ao atualizar status da empresa')
        }
    }

    return (
        <div className="sa-dashboard fade-in">
            <div className="sa-header-block">
                <h1>Painel de Governança</h1>
                <p>Monitoramento e controle de tenants</p>
            </div>

            {loading ? (
                <div className="loading-state">Carregando métricas...</div>
            ) : (
                <div className="sa-table-container">
                    <table className="sa-table">
                        <thead>
                            <tr>
                                <th>Empresa</th>
                                <th>Tipo</th>
                                <th>Status Conta</th>
                                <th>Saúde (Atividade)</th>
                                <th>Usuários</th>
                                <th>Tarefas Ativas</th>
                                <th>Última Ativ.</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.map(company => (
                                <tr key={company.empresa_id}>
                                    <td className="fw-500">{company.nome}</td>
                                    <td className="text-muted">{company.tipo_negocio || '-'}</td>
                                    <td>{renderAccountStatus(company.status_conta)}</td>
                                    <td>{renderHealthBadge(company.health_status)}</td>
                                    <td>{company.users_count}</td>
                                    <td>{company.active_tasks_count}</td>
                                    <td className="text-small">
                                        {company.last_activity_at ? new Date(company.last_activity_at).toLocaleDateString() : '-'}
                                    </td>
                                    <td>
                                        <button
                                            className="btn-action-icon"
                                            onClick={() => {
                                                setSelectedCompany(company)
                                                setActionNote('')
                                                setShowModal(true)
                                            }}
                                        >
                                            <MoreVertical size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {showModal && selectedCompany && (
                <div className="modal-backdrop-sa" onClick={() => setShowModal(false)}>
                    <div className="modal-sa" onClick={e => e.stopPropagation()}>
                        <h3>Gerenciar: {selectedCompany.nome}</h3>

                        <div className="modal-sa-content">
                            <p>Status atual: <strong>{selectedCompany.status_conta}</strong></p>

                            <label>Nota Interna (Opcional)</label>
                            <textarea
                                value={actionNote}
                                onChange={e => setActionNote(e.target.value)}
                                placeholder="Motivo da ação..."
                            />

                            <div className="modal-sa-actions">
                                <button onClick={handleToggleSuspension} className={`btn-large ${selectedCompany.status_conta === 'suspended' ? 'btn-success' : 'btn-danger'}`}>
                                    {selectedCompany.status_conta === 'suspended' ? 'Reativar Empresa' : 'SUSPENDER EMPRESA'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
