import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from 'sonner'
import { Save, User, Calendar, AlertTriangle, FileText, ArrowLeft } from 'lucide-react'

import '../../styles/admin-forms.css'

function StaffRequestCreate() {
    const navigate = useNavigate()
    const { user } = useAuth()

    const [loading, setLoading] = useState(false)
    const [loadingCompany, setLoadingCompany] = useState(true)
    const [userCompanies, setUserCompanies] = useState([])
    const [selectedEmpresaId, setSelectedEmpresaId] = useState(null)
    const [professionals, setProfessionals] = useState([])

    // Form State
    const [formData, setFormData] = useState({
        titulo: '',
        descricao: '',
        priority: 'normal',
        assigned_to: '',
        deadline: '',
        drive_link: ''
    })

    // Fetch user's companies
    useEffect(() => {
        async function fetchUserCompanies() {
            if (!user?.id) return

            try {
                setLoadingCompany(true)
                const { data, error } = await supabase
                    .from('empresa_profissionais')
                    .select('empresa_id, empresas!inner(id, nome, empresa_tipo)')
                    .eq('profissional_id', user.id)
                    .eq('ativo', true)
                    .eq('empresas.empresa_tipo', 'operacional')

                if (error) throw error

                if (!data || data.length === 0) {
                    toast.error('Você não está vinculado a nenhuma empresa operacional')
                    navigate('/staff/dashboard')
                    return
                }

                setUserCompanies(data)

                if (data.length === 1) {
                    setSelectedEmpresaId(data[0].empresa_id)
                }

            } catch (error) {
                console.error('Error fetching companies:', error)
                toast.error('Erro ao carregar empresas')
                navigate('/staff/dashboard')
            } finally {
                setLoadingCompany(false)
            }
        }

        fetchUserCompanies()
    }, [user, navigate])

    // Fetch professionals
    useEffect(() => {
        if (selectedEmpresaId) {
            fetchProfessionals()
        }
    }, [selectedEmpresaId])

    async function fetchProfessionals() {
        if (!selectedEmpresaId) return

        try {
            const { data, error } = await supabase
                .from('empresa_profissionais')
                .select(`
                    profissional_id,
                    profissionais!inner (
                        id,
                        nome
                    )
                `)
                .eq('empresa_id', selectedEmpresaId)
                .eq('ativo', true)
                .neq('profissional_id', user?.id)

            if (error) throw error

            const professionals = data?.map(ep => ({
                id: ep.profissionais.id,
                nome: ep.profissionais.nome
            })) || []

            setProfessionals(professionals)
        } catch (error) {
            console.error('Error fetching professionals:', error)
            toast.error('Erro ao carregar lista de profissionais')
        }
    }

    async function handleSubmit(e) {
        e.preventDefault()

        if (!formData.titulo || !formData.assigned_to || !formData.deadline) {
            toast.error('Preencha os campos obrigatórios')
            return
        }

        if (!selectedEmpresaId) {
            toast.error('Selecione uma empresa')
            return
        }

        try {
            setLoading(true)

            const { error } = await supabase
                .from('tarefas')
                .insert([{
                    titulo: formData.titulo,
                    descricao: formData.descricao,
                    prioridade: formData.priority,
                    assigned_to: formData.assigned_to,
                    created_by: user.id,
                    empresa_id: selectedEmpresaId,
                    deadline: new Date(formData.deadline).toISOString(),
                    drive_link: formData.drive_link,
                    status: 'pendente'
                }])

            if (error) throw error

            toast.success('Solicitação criada com sucesso!')
            navigate('/staff/tasks')
        } catch (error) {
            console.error('Error creating request:', error)
            toast.error('Erro ao criar solicitação')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="admin-page-container py-4">
            {loadingCompany ? (
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
                </div>
            ) : (
                <>
                    {/* Header: Back Button Only (Title Removed for UX Focus) */}
                    <div className="flex items-center mb-4">
                        <button
                            onClick={() => navigate(-1)}
                            className="admin-back-btn"
                        >
                            <ArrowLeft size={18} />
                        </button>
                    </div>

                    {/* Main Content Card */}
                    <div className="card">
                        <form onSubmit={handleSubmit} className="admin-form">

                            {/* Section 1: Core Information */}
                            <div className="flex flex-col gap-4">
                                {userCompanies.length > 1 && (
                                    <div className="admin-form-group">
                                        <label className="admin-form-label">
                                            Empresa (Solicitante) <span className="text-danger">*</span>
                                        </label>
                                        <select
                                            className="admin-form-select"
                                            value={selectedEmpresaId || ''}
                                            onChange={(e) => setSelectedEmpresaId(e.target.value)}
                                            required
                                        >
                                            <option value="">Selecione a empresa...</option>
                                            {userCompanies.map((company) => (
                                                <option key={company.empresa_id} value={company.empresa_id}>
                                                    {company.empresas.nome}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div className="admin-form-group">
                                    <label className="admin-form-label">
                                        <FileText size={18} className="admin-form-label-icon" />
                                        Título da Solicitação <span className="text-danger">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        className="admin-form-input"
                                        placeholder="Ex: Atualizar relatório de vendas"
                                        value={formData.titulo}
                                        onChange={e => setFormData({ ...formData, titulo: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="admin-form-group">
                                    <label className="admin-form-label">
                                        Descrição Detalhada
                                    </label>
                                    <textarea
                                        className="admin-form-textarea"
                                        placeholder="Descreva o que precisa ser feito..."
                                        value={formData.descricao}
                                        onChange={e => setFormData({ ...formData, descricao: e.target.value })}
                                    />
                                </div>
                            </div>

                            {/* Section 2: Logistics & execution details */}
                            <div className="flex flex-col gap-4">
                                <div className="admin-form-group">
                                    <label className="admin-form-label">
                                        <User size={18} className="admin-form-label-icon" />
                                        Para Quem? <span className="text-danger">*</span>
                                    </label>
                                    <select
                                        className="admin-form-select"
                                        value={formData.assigned_to}
                                        onChange={e => setFormData({ ...formData, assigned_to: e.target.value })}
                                        required
                                    >
                                        <option value="">Selecione um colaborador</option>
                                        {professionals.map(prof => (
                                            <option key={prof.id} value={prof.id}>
                                                {prof.nome}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="admin-form-group">
                                    <label className="admin-form-label">
                                        <AlertTriangle size={18} className="admin-form-label-icon" />
                                        Prioridade
                                    </label>
                                    <select
                                        className="admin-form-select"
                                        value={formData.priority}
                                        onChange={e => setFormData({ ...formData, priority: e.target.value })}
                                    >
                                        <option value="baixa">Baixa</option>
                                        <option value="normal">Média</option>
                                        <option value="alta">Alta</option>
                                        <option value="urgente">Urgente</option>
                                    </select>
                                </div>

                                <div className="admin-form-group">
                                    <label className="admin-form-label">
                                        <Calendar size={18} className="admin-form-label-icon" />
                                        Prazo Final <span className="text-danger">*</span>
                                    </label>
                                    <input
                                        type="datetime-local"
                                        className="admin-form-input"
                                        value={formData.deadline}
                                        onChange={e => setFormData({ ...formData, deadline: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="admin-form-group">
                                    <label className="admin-form-label">
                                        Link de Arquivos
                                    </label>
                                    <input
                                        type="url"
                                        className="admin-form-input"
                                        placeholder="https://drive.google.com/..."
                                        value={formData.drive_link}
                                        onChange={e => setFormData({ ...formData, drive_link: e.target.value })}
                                    />
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="admin-form-actions">
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="btn btn-primary w-full justify-center"
                                >
                                    {loading ? 'Criando...' : 'Enviar Solicitação'}
                                    <Save size={20} />
                                </button>
                            </div>
                        </form>
                    </div>
                </>
            )}
        </div>
    )
}

export default StaffRequestCreate
