import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { ArrowLeft, Users, Shield, Activity, Ban, CheckCircle, Mail, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import '../../styles/super-admin-dashboard.css'

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

            // RPC returns set of rows, but since we query by ID, should be one row
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

    if (loading) return <div className="p-8">Carregando governança...</div>
    if (!company) return null

    return (
        <div className="sa-dashboard fade-in">
            <div className="mb-6">
                <button onClick={() => navigate('/platform/companies')} className="flex items-center gap-2 text-text-tertiary hover:text-primary mb-4">
                    <ArrowLeft size={16} /> Voltar para lista
                </button>

                <div className="flex justify-between items-start">
                    <div>
                        <h1 className="text-2xl font-bold text-text-primary mb-1">{company.nome}</h1>
                        <div className="flex items-center gap-3 text-sm text-text-secondary">
                            <span>CNPJ: {company.cnpj || 'Não informado'}</span>
                            <span className="w-1 h-1 rounded-full bg-text-tertiary"></span>
                            <span className={`font-medium ${company.status_conta === 'suspended' ? 'text-red-500' : 'text-emerald-500'}`}>
                                {company.status_conta === 'active' ? 'Ativo' : 'Suspenso'}
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={handleSuspendToggle}
                        className={`px-4 py-2 rounded-lg font-medium text-white transition-colors ${company.status_conta === 'suspended' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
                            }`}
                    >
                        {company.status_conta === 'suspended' ? 'Reativar Acesso' : 'SUSPENDER ACESSO'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                {/* Stats Cards */}
                <div className="bg-surface border border-border rounded-xl p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <Users className="text-primary" size={20} />
                        <h3 className="font-semibold text-text-primary">Total Usuários</h3>
                    </div>
                    <p className="text-3xl font-bold text-text-primary">{company.staff_count}</p>
                </div>

                <div className="bg-surface border border-border rounded-xl p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <Shield className="text-secondary" size={20} />
                        <h3 className="font-semibold text-text-primary">Admins</h3>
                    </div>
                    <p className="text-3xl font-bold text-text-primary">{company.admins_count}</p>
                </div>

                <div className="bg-surface border border-border rounded-xl p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <Activity className="text-orange-500" size={20} />
                        <h3 className="font-semibold text-text-primary">Saúde</h3>
                    </div>
                    <p className="text-xl font-bold capitalize text-text-secondary">{company.health_status === 'healthy' ? 'Saudável 🟢' : company.health_status === 'low_activity' ? 'Baixa Atividade 🟡' : 'Inativo 🔴'}</p>
                </div>
            </div>

            {/* Governance Section */}
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
                <div className="p-5 border-b border-border bg-bg-subtle flex justify-between items-center">
                    <h2 className="font-semibold text-lg flex items-center gap-2">
                        <Shield size={18} />
                        Gestão de Administradores (Governança)
                    </h2>
                    <button className="text-sm text-primary hover:underline font-medium">
                        + Novo Admin
                    </button>
                </div>

                <table className="w-full text-left">
                    <thead className="bg-bg-subtle text-xs uppercase text-text-tertiary font-semibold">
                        <tr>
                            <th className="px-6 py-4">Nome</th>
                            <th className="px-6 py-4">Email</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4 text-right">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {company.admins_list && company.admins_list.map(admin => (
                            <tr key={admin.id} className="hover:bg-bg-subtle transition-colors">
                                <td className="px-6 py-4 font-medium text-text-primary">{admin.nome}</td>
                                <td className="px-6 py-4 text-text-secondary flex items-center gap-2">
                                    <Mail size={14} /> {admin.email}
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`text-xs px-2 py-1 rounded-full border ${admin.ativo ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                                        {admin.ativo ? 'Ativo' : 'Inativo'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <button
                                        onClick={() => handleResetPassword(admin.email)}
                                        className="text-text-tertiary hover:text-primary transition-colors p-2 rounded hover:bg-bg-app"
                                        title="Enviar Redefinição de Senha"
                                    >
                                        <RotateCw size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {(!company.admins_list || company.admins_list.length === 0) && (
                            <tr>
                                <td colSpan="4" className="px-6 py-8 text-center text-text-tertiary">Nenhum administrador encontrado (Crítico).</td>
                            </tr>
                        )}
                    </tbody>
                </table>
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
