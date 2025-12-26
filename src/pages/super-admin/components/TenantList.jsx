import { useNavigate } from 'react-router-dom'
import { MoreVertical, Users, Key, Monitor, Activity, CheckCircle, AlertTriangle, Ban } from 'lucide-react'
import '../../../styles/super-admin-dashboard.css' // Corrected path

export default function TenantList({ companies }) {
    const navigate = useNavigate()

    function renderHealthBadge(status) {
        const config = {
            healthy: { color: '#10b981', label: 'Saudável', icon: CheckCircle },
            low_activity: { color: '#f59e0b', label: 'Baixa Ativ.', icon: AlertTriangle },
            inactive: { color: '#ef4444', label: 'Inativo', icon: Ban },
        }
        const current = config[status] || config.inactive
        const Icon = current.icon

        return (
            <div className="flex items-center gap-1 text-xs px-2 py-1 rounded-full"
                style={{ color: current.color, backgroundColor: `${current.color}15`, border: `1px solid ${current.color}30` }}>
                <Icon size={12} />
                <span className="font-medium">{current.label}</span>
            </div>
        )
    }

    /* 
       Using the Premium Card style requested in plan.
    */
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {companies.map(company => (
                <div key={company.empresa_id} className="bg-surface rounded-xl border border-border p-5 hover:shadow-lg transition-all">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h3 className="text-lg font-semibold text-text-primary">{company.nome}</h3>
                            <div className="flex items-center gap-2 mt-1">
                                <span className={`text-xs px-2 py-0.5 rounded font-medium ${company.status_conta === 'active' ? 'bg-emerald-50 text-emerald-600' :
                                    company.status_conta === 'suspended' ? 'bg-red-50 text-red-600' :
                                        'bg-blue-50 text-blue-600'
                                    }`}>
                                    {company.status_conta === 'active' ? 'Ativo' :
                                        company.status_conta === 'suspended' ? 'Suspenso' : 'Trial'}
                                </span>
                                <span className="text-xs text-text-tertiary uppercase">{company.tipo_negocio || 'Outro'}</span>
                            </div>
                        </div>
                        <button
                            onClick={() => navigate(`/platform/companies/${company.empresa_id}`)}
                            className="p-2 hover:bg-bg-subtle rounded-lg text-text-tertiary hover:text-primary transition-colors"
                        >
                            <Monitor size={18} />
                        </button>
                    </div>

                    <div className="space-y-3">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-text-secondary flex items-center gap-2">
                                <Users size={14} className="text-text-tertiary" /> Usuários
                            </span>
                            <span className="font-medium text-text-primary">{company.users_count}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-text-secondary flex items-center gap-2">
                                <Activity size={14} className="text-text-tertiary" /> Tarefas Ativas
                            </span>
                            <span className="font-medium text-text-primary">{company.active_tasks_count}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm pt-2 border-t border-border mt-3">
                            <span className="text-text-secondary text-xs">Saúde do Tenant</span>
                            {renderHealthBadge(company.health_status)}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    )
}
