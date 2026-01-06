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
    const [professionals, setProfessionals] = useState([])

    // Form State
    const [formData, setFormData] = useState({
        titulo: '',
        descricao: '',
        priority: 'medium',
        assigned_to: '',
        deadline: '',
        drive_link: ''
    })

    useEffect(() => {
        fetchProfessionals()
    }, [])

    async function fetchProfessionals() {
        try {
            const { data, error } = await supabase
                .from('profissionais')
                .select('id, nome')
                .eq('ativo', true)
                .neq('id', user?.id)
                .order('nome')

            if (error) throw error
            setProfessionals(data || [])
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

        try {
            setLoading(true)

            const { error } = await supabase
                .from('tarefas')
                .insert([{
                    titulo: formData.titulo,
                    descricao: formData.descricao,
                    priority: formData.priority,
                    assigned_to: formData.assigned_to,
                    deadline: new Date(formData.deadline).toISOString(),
                    drive_link: formData.drive_link,
                    status: 'pending'
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
                                <option value="low">Baixa</option>
                                <option value="medium">Média</option>
                                <option value="high">Alta</option>
                                <option value="urgent">Urgente</option>
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
        </div>
    )
}

export default StaffRequestCreate
