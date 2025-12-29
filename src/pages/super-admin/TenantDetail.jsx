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

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
    const [newAdminData, setNewAdminData] = useState({ nome: '', email: '' })
    const [createLoading, setCreateLoading] = useState(false)

    async function handleCreateAdmin(e) {
        e.preventDefault()
        if (!newAdminData.nome || !newAdminData.email) {
            toast.error('Preencha todos os campos')
            return
        }

        try {
            setCreateLoading(true)

            // 1. Create Professional (Auth + Profile)
            // Using professionalsService directly if available, or importing it later. 
            // For now, let's assume we need to import it or use a direct call if not imported.
            // Looking at imports, professionalsService is NOT imported. I will use supabase.functions directly to match existing pattern or add import.
            // Actually, the plan said "Call professionalsService.create". I should probably import it.
            // But to avoid changing imports in this tool call (which is risky if I miss context), I'll use the implementations I saw in professionals.js directly here OR add the import in a separate step?
            // Wait, I can't add import here easily without reading top of file.
            // I will implement the logic using supabase.functions and supabase directly, mirroring professionalsService logic, to be safe and self-contained, 
            // OR better yet, I will assume I can edit the whole file or just use the ViewFile content I have.
            // Let's use supabase.functions directly as per `professionalsService.create` implementation I saw.

            // 1. Create User
            const { data: createData, error: createError } = await supabase.functions.invoke('create-professional', {
                body: {
                    nome: newAdminData.nome,
                    email: newAdminData.email,
                    role: 'admin', // Default to admin for this flow
                    area_id: null
                }
            })

            if (createError) throw new Error(createError.message)
            if (createData?.error) throw new Error(createData.error)

            const newUserId = createData.id
            const inviteLink = createData.inviteLink

            // 2. Link to this Tenant
            const { error: linkError } = await supabase
                .from('empresa_profissionais')
                .insert([{
                    empresa_id: id, // from useParams
                    profissional_id: newUserId,
                    funcao: 'Admin',
                    ativo: true
                }])

            if (linkError) throw linkError

            // Success
            toast.success('Admin criado com sucesso!')

            // Show Invite Link (Optional but good UX)
            // For now just close and refresh, or maybe show a persistent toast?
            if (inviteLink) {
                // Copy to clipboard automatically or show
                await navigator.clipboard.writeText(inviteLink)
                toast.success('Link de convite copiado para a área de transferência!')
            }

            setIsCreateModalOpen(false)
            setNewAdminData({ nome: '', email: '' })
            fetchDetails()

        } catch (error) {
            console.error('Error creating admin:', error)
            toast.error(error.message || 'Erro ao criar administrador')
        } finally {
            setCreateLoading(false)
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
                    <button
                        className="btn btn-ghost"
                        style={{ color: 'var(--color-primary)' }}
                        onClick={() => setIsCreateModalOpen(true)}
                    >
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

            {/* Create Admin Modal */}
            {isCreateModalOpen && (
                <div className="modal-overlay" style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
                }}>
                    <div className="modal-content" style={{
                        background: 'white', padding: '24px', borderRadius: '12px', width: '100%', maxWidth: '400px',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                    }}>
                        <h3 className="text-lg font-bold mb-4">Adicionar Novo Admin</h3>
                        <form onSubmit={handleCreateAdmin}>
                            <div className="form-group mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                                <input
                                    type="text"
                                    className="form-input w-full p-2 border rounded-md"
                                    value={newAdminData.nome}
                                    onChange={e => setNewAdminData({ ...newAdminData, nome: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="form-group mb-6">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                <input
                                    type="email"
                                    className="form-input w-full p-2 border rounded-md"
                                    value={newAdminData.email}
                                    onChange={e => setNewAdminData({ ...newAdminData, email: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => setIsCreateModalOpen(false)}
                                    disabled={createLoading}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={createLoading}
                                >
                                    {createLoading ? 'Criando...' : 'Criar Admin'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
