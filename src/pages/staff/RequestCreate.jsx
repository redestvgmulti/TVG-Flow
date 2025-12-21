import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from 'sonner'
import { Save, User, Calendar, AlertTriangle, FileText, ArrowLeft } from 'lucide-react'

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
                .neq('id', user?.id) // Optional: exclude self if requests are meant for OTHERS
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
                    status: 'pending',
                    // Note: 'created_by' isn't in your schema yet based on earlier context, 
                    // but if it were, we'd add it here. RLS handles auth.
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
        <div className="animation-fade-in max-w-2xl mx-auto pb-12">
            <button
                onClick={() => navigate(-1)}
                className="mb-6 text-sm text-secondary hover:text-primary flex items-center gap-1 transition-colors"
            >
                <ArrowLeft size={16} />
                Voltar
            </button>

            <div className="mb-8">
                <h1 className="text-3xl font-bold text-primary mb-2">Nova Solicitação</h1>
                <p className="text-secondary">Crie uma tarefa para outro colaborador.</p>
            </div>

            <div className="card p-8">
                <form onSubmit={handleSubmit} className="flex flex-col gap-6">

                    {/* Title */}
                    <div className="form-group">
                        <label className="flex items-center gap-2 mb-1">
                            <FileText size={16} className="text-brand" />
                            Título da Solicitação <span className="text-danger">*</span>
                        </label>
                        <input
                            type="text"
                            className="input"
                            placeholder="Ex: Atualizar relatório de vendas"
                            value={formData.titulo}
                            onChange={e => setFormData({ ...formData, titulo: e.target.value })}
                            required
                        />
                    </div>

                    {/* Description */}
                    <div className="form-group">
                        <label className="flex items-center gap-2 mb-1">
                            Descrição Detalhada
                        </label>
                        <textarea
                            className="input min-h-[120px]"
                            placeholder="Descreva o que precisa ser feito..."
                            value={formData.descricao}
                            onChange={e => setFormData({ ...formData, descricao: e.target.value })}
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Assign To */}
                        <div className="form-group">
                            <label className="flex items-center gap-2 mb-1">
                                <User size={16} className="text-brand" />
                                Para Quem? <span className="text-danger">*</span>
                            </label>
                            <select
                                className="input"
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
                            <label className="flex items-center gap-2 mb-1">
                                <AlertTriangle size={16} className="text-brand" />
                                Prioridade
                            </label>
                            <select
                                className="input"
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Deadline */}
                        <div className="form-group">
                            <label className="flex items-center gap-2 mb-1">
                                <Calendar size={16} className="text-brand" />
                                Prazo Final <span className="text-danger">*</span>
                            </label>
                            <input
                                type="datetime-local"
                                className="input"
                                value={formData.deadline}
                                onChange={e => setFormData({ ...formData, deadline: e.target.value })}
                                required
                            />
                        </div>

                        {/* Drive Link */}
                        <div className="form-group">
                            <label className="flex items-center gap-2 mb-1">
                                Link de Arquivos (opcional)
                            </label>
                            <input
                                type="url"
                                className="input"
                                placeholder="https://drive.google.com/..."
                                value={formData.drive_link}
                                onChange={e => setFormData({ ...formData, drive_link: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="pt-4 border-t border-gray-100 mt-2">
                        <button
                            type="submit"
                            disabled={loading}
                            className="btn btn-primary w-full py-3 text-base justify-center"
                        >
                            {loading ? 'Criando...' : 'Enviar Solicitação'}
                            <Save size={18} />
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

export default StaffRequestCreate
