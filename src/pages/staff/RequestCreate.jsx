import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from 'sonner'
import { Save, User, Calendar, AlertTriangle, FileText, ArrowLeft } from 'lucide-react'

import '../../styles/request-create.css'

function StaffRequestCreate() {
    const navigate = useNavigate()
    const { user } = useAuth()

    const [loading, setLoading] = useState(false)
    const [loadingCompany, setLoadingCompany] = useState(true)
    const [userCompanies, setUserCompanies] = useState([]) // All companies user is linked to
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

                // If only 1 company, auto-select it silently
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

    // Fetch professionals after company is selected
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
        <div className="request-create-container">
            {loadingCompany ? (
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
                </div>
            ) : (
                <>
                    <div className="request-header">
                        <button
                            onClick={() => navigate(-1)}
                            className="request-back-btn"
                        >
                            <ArrowLeft size={18} />
                            Voltar
                        </button>
                        <h1 className="request-title">Nova Solicitação</h1>
                        <p className="request-subtitle">Crie uma tarefa para outro colaborador.</p>
                    </div>

                    <div className="request-card">
                        <form onSubmit={handleSubmit} className="request-form">

                            {/* Empresa Selector - Only show if user has multiple companies */}
                            {userCompanies.length > 1 && (
                                <div className="form-group">
                                    <label className="form-label">
                                        Empresa (Solicitante) <span className="form-required">*</span>
                                    </label>
                                    <select
                                        className="form-select"
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

                            {/* Title */}
                            <div className="form-group">
                                <label className="form-label">
                                    <FileText size={18} className="form-label-icon" />
                                    Título da Solicitação <span className="form-required">*</span>
                                </label>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Ex: Atualizar relatório de vendas"
                                    value={formData.titulo}
                                    onChange={e => setFormData({ ...formData, titulo: e.target.value })}
                                    required
                                />
                            </div>

                            {/* Description */}
                            <div className="form-group">
                                <label className="form-label">
                                    Descrição Detalhada
                                </label>
                                <textarea
                                    className="form-textarea"
                                    placeholder="Descreva o que precisa ser feito..."
                                    value={formData.descricao}
                                    onChange={e => setFormData({ ...formData, descricao: e.target.value })}
                                />
                            </div>

                            <div className="form-grid">
                                {/* Assign To */}
                                <div className="form-group">
                                    <label className="form-label">
                                        <User size={18} className="form-label-icon" />
                                        Para Quem? <span className="form-required">*</span>
                                    </label>
                                    <select
                                        className="form-select"
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

                                {/* Priority */}
                                <div className="form-group">
                                    <label className="form-label">
                                        <AlertTriangle size={18} className="form-label-icon" />
                                        Prioridade
                                    </label>
                                    <select
                                        className="form-select"
                                        value={formData.priority}
                                        onChange={e => setFormData({ ...formData, priority: e.target.value })}
                                    >
                                        <option value="baixa">Baixa</option>
                                        <option value="normal">Média</option>
                                        <option value="alta">Alta</option>
                                        <option value="urgente">Urgente</option>
                                    </select>
                                </div>
                            </div>

                            <div className="form-grid">
                                {/* Deadline */}
                                <div className="form-group">
                                    <label className="form-label">
                                        <Calendar size={18} className="form-label-icon" />
                                        Prazo Final <span className="form-required">*</span>
                                    </label>
                                    <input
                                        type="datetime-local"
                                        className="form-input"
                                        value={formData.deadline}
                                        onChange={e => setFormData({ ...formData, deadline: e.target.value })}
                                        required
                                    />
                                </div>

                                {/* Drive Link */}
                                <div className="form-group">
                                    <label className="form-label">
                                        Link de Arquivos (opcional)
                                    </label>
                                    <input
                                        type="url"
                                        className="form-input"
                                        placeholder="https://drive.google.com/..."
                                        value={formData.drive_link}
                                        onChange={e => setFormData({ ...formData, drive_link: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="form-footer">
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="btn-submit"
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
