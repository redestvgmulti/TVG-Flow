import { useNavigate } from 'react-router-dom'
import { Monitor, CheckCircle, AlertTriangle, Ban } from 'lucide-react'
// Imported implicitly via parent or can import specific styles if needed, 
// but adminReports.css is global enough for these classes.

export default function TenantList({ companies }) {
    const navigate = useNavigate()

    function renderHealthBadge(status) {
        // Mapped to match report badge styles or keep custom custom if report ones aren't rich enough,
        // but user asked for "same css", so let's stick to report classes where possible or similar aesthetic.
        // Reports uses .badge-success, .badge-error, etc.

        let badgeClass = 'badge-neutral'
        let label = 'Desconhecido'

        if (status === 'healthy') {
            badgeClass = 'badge-success'
            label = 'Saudável'
        } else if (status === 'low_activity') {
            badgeClass = 'badge-error' // Using error color for warning to match report style or add warning
            label = 'Baixa Ativ.'
        } else if (status === 'inactive') {
            badgeClass = 'badge-error'
            label = 'Inativo'
        }

        return (
            <span className={badgeClass} style={{ padding: '0 8px', minWidth: '80px' }}>
                {label}
            </span>
        )
    }

    return (
        <div className="reports-table-container">
            <table className="reports-table">
                <thead>
                    <tr>
                        <th>Empresa</th>
                        <th>Segmento</th>
                        <th className="align-center">Usuários</th>
                        <th className="align-center">Tarefas Ativas</th>
                        <th className="align-center">Status</th>
                        <th className="align-center">Saúde</th>
                        <th className="align-right">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    {companies.map(company => (
                        <tr key={company.id} className="hover:bg-bg-subtle transition-colors">
                            <td>
                                <span className="font-semibold text-text-primary">{company.nome}</span>
                            </td>
                            <td>
                                <span className="text-xs text-text-tertiary uppercase font-medium">
                                    {company.tipo_negocio || '-'}
                                </span>
                            </td>
                            <td className="align-center">{company.users_count}</td>
                            <td className="align-center">{company.active_tasks_count}</td>
                            <td className="align-center">
                                <span className={
                                    company.status_conta === 'active' ? 'badge-success' :
                                        company.status_conta === 'suspended' ? 'badge-error' :
                                            'badge-neutral'
                                } style={{ padding: '0 8px', minWidth: '80px' }}>
                                    {company.status_conta === 'active' ? 'Ativo' :
                                        company.status_conta === 'suspended' ? 'Suspenso' : 'Trial'}
                                </span>
                            </td>
                            <td className="align-center">
                                {renderHealthBadge(company.health_status)}
                            </td>
                            <td className="align-right">
                                <button
                                    onClick={() => navigate(`/platform/companies/${company.id}`)}
                                    className="btn btn-secondary"
                                    style={{ padding: '6px', minWidth: '32px' }}
                                    title="Gerenciar Tenant"
                                >
                                    <Monitor size={16} />
                                </button>
                            </td>
                        </tr>
                    ))}
                    {companies.length === 0 && (
                        <tr>
                            <td colSpan="7" className="text-center py-8 text-text-secondary">
                                Nenhuma empresa cadastrada.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    )
}
