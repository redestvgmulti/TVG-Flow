import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { ArrowLeft, Users, Shield, Activity, Mail, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import '../../styles/adminReports.css' // Using Reports style

export default function TenantDetail() {
    const { id } = useParams()
    const navigate = useNavigate()
    const [company, setCompany] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchDetails()
    }, [id])

    async function fetchDetails() {
        try {
            setLoading(true)
            const { data, error } = await supabase.rpc('get_tenant_details', { target_company_id: id })
            if (error) throw error

            if (data && data.length > 0) {
                setCompany(data[0])
            } else {
                toast.error('Empresa não encontrada')
                navigate('/platform/companies')
            }
        } catch (error) {
            console.error('Error fetching tenant details:', error)
            toast.error('Erro ao carregar detalhes')
        } finally {
            setLoading(false)
        }
    }

    async function handleSuspendToggle() {
        if (!company) return
        const newStatus = company.status_conta === 'suspended' ? 'active' : 'suspended'

        try {
            const { error } = await supabase.from('empresas')
                .update({ status_conta: newStatus })
                .eq('id', company.id)

            if (error) throw error

            toast.success(`Empresa ${newStatus === 'active' ? 'reativada' : 'suspensa'} com sucesso`)
            fetchDetails()
        } catch (error) {
            toast.error('Erro ao atualizar status')
        }
    }

    async function handleResetPassword(email) {
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + '/reset-password',
            })
            if (error) throw error
            toast.success(`E-mail de redefinição enviado para ${email}`)
        } catch (error) {
            console.error(error)
            toast.error('Erro ao enviar reset de senha: ' + error.message)
        }
    }

    if (loading) return (
        <div className="reports-loading">
            <div className="loading-spinner"></div>
        </div>
    )
    if (!company) return null

    return (
        <div className="reports-container fade-in">
            {/* Header */}
            <div className="reports-header" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: '16px' }}>
                <button onClick={() => navigate('/platform/companies')} className="btn btn-ghost" style={{ paddingLeft: 0, color: 'var(--color-text-tertiary)' }}>
                    <ArrowLeft size={16} /> Voltar para lista
                </button>

                <div className="flex justify-between items-end w-full">
                    <div className="reports-title">
                        <div className="flex items-center gap-3">
                            <h1>{company.nome}</h1>
                            <span className={`text-xs px-2 py-1 rounded-full border font-medium ${company.status_conta === 'active' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                                {company.status_conta === 'active' ? 'Ativo' : 'Suspenso'}
                            </span>
                        </div>
                        <p>CNPJ: {company.cnpj || 'Não informado'} • Governança do Tenant</p>
                    </div>

                    <button
                        onClick={handleSuspendToggle}
                        className={`btn ${company.status_conta === 'suspended' ? 'btn-primary' : 'btn-danger'}`}
                    >
                        {company.status_conta === 'suspended' ? 'Reativar Acesso' : 'SUSPENDER ACESSO'}
                    </button>
                </div>
            </div>

            {/* Stats Grid - Using Roles Grid style */}
            <div className="roles-grid mb-8">
                <div className="role-card">
                    <div className="role-header">
                        <span className="role-title">Total Usuários</span>
                        <div className="role-icon"><Users size={20} /></div>
                    </div>
                    <div className="role-stats">
                        <div className="stat-value" style={{ fontSize: '24px' }}>{company.staff_count}</div>
                    </div>
                </div>

                <div className="role-card">
                    <div className="role-header">
                        <span className="role-title">Admins</span>
                        <div className="role-icon"><Shield size={20} /></div>
                    </div>
                    <div className="role-stats">
                        <div className="stat-value" style={{ fontSize: '24px' }}>{company.admins_count}</div>
                    </div>
                </div>

                <div className="role-card">
                    <div className="role-header">
                        <span className="role-title">Saúde</span>
                        <div className="role-icon"><Activity size={20} /></div>
                    </div>
                    <div className="role-stats">
                        <div className="stat-value" style={{ fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {company.health_status === 'healthy' ? (
                                <><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Saudável</>
                            ) : company.health_status === 'low_activity' ? (
                                <><span className="w-2 h-2 rounded-full bg-amber-500"></span> Baixa Atividade</>
                            ) : (
                                <><span className="w-2 h-2 rounded-full bg-red-500"></span> Inativo</>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Governance Section - Using Reports Content/Table style */}
            <div className="reports-content">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
                        <Shield size={18} className="text-primary" />
                        Gestão de Administradores (Governança)
                    </h2>
                    <button className="btn btn-ghost" style={{ color: 'var(--color-primary)' }}>
                        + Novo Admin
                    </button>
                </div>

                <div className="reports-table-container">
                    <table className="reports-table">
                        <thead>
                            <tr>
                                <th>Nome</th>
                                <th>Email</th>
                                <th className="align-center">Status</th>
                                <th className="align-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {company.admins_list && company.admins_list.map(admin => (
                                <tr key={admin.id}>
                                    <td className="font-medium">{admin.nome}</td>
                                    <td className="text-text-secondary flex items-center gap-2">
                                        <Mail size={14} /> {admin.email}
                                    </td>
                                    <td className="align-center">
                                        <span className={`badge-neutral ${admin.ativo ? 'badge-success' : 'badge-error'}`} style={{ width: 'auto', padding: '0 8px' }}>
                                            {admin.ativo ? 'Ativo' : 'Inativo'}
                                        </span>
                                    </td>
                                    <td className="align-right">
                                        <button
                                            onClick={() => handleResetPassword(admin.email)}
                                            className="btn btn-secondary"
                                            style={{ padding: '6px', minWidth: '32px' }}
                                            title="Enviar Redefinição de Senha"
                                        >
                                            <RotateCw size={14} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {(!company.admins_list || company.admins_list.length === 0) && (
                                <tr>
                                    <td colSpan="4" className="text-center py-8 text-text-tertiary">
                                        Nenhum administrador encontrado (Crítico).
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="mt-6 p-4 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-800 flex items-start gap-3">
                <Shield className="shrink-0 mt-0.5" size={16} />
                <div>
                    <strong>Nota de Governança:</strong> O Super Admin controla a <em>existência</em> dos dados, mas não deve realizar micromanagement.
                    A criação de tarefas e gestão de staff deve ser feita pelo Admin do Tenant logado.
                </div>
            </div>
        </div>
    )
}
