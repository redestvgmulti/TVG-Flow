import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { toast } from 'sonner'
import {
    Users,
    UserPlus,
    Search,
    Mail,
    Shield,
    User,
    CheckCircle,
    XCircle,
    Edit,
    Trash2,
    AlertTriangle,
    Building2
} from 'lucide-react'

function Professionals() {
    const [professionals, setProfessionals] = useState([])
    const [loading, setLoading] = useState(true)
    const [showAddModal, setShowAddModal] = useState(false)
    const [showEditModal, setShowEditModal] = useState(false)
    const [editingStaff, setEditingStaff] = useState(null)
    const [newStaff, setNewStaff] = useState({
        nome: '',
        email: '',
        role: 'profissional',
        ativo: true,
        area_id: ''
    })
    const [editStaff, setEditStaff] = useState({
        nome: '',
        role: '',
        ativo: true
    })
    const [creating, setCreating] = useState(false)
    const [updating, setUpdating] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [areas, setAreas] = useState([])
    const [searchTerm, setSearchTerm] = useState('')

    useEffect(() => {
        fetchProfessionals()
        fetchAreas()
    }, [])

    async function fetchProfessionals() {
        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('profissionais')
                .select('id, nome, email, role, ativo, created_at')
                .order('created_at', { ascending: false })

            if (error) throw error
            setProfessionals(data || [])
        } catch (error) {
            console.error('Error fetching professionals:', error)
            toast.error('Falha ao carregar profissionais')
        } finally {
            setLoading(false)
        }
    }

    async function fetchAreas() {
        try {
            const { data, error } = await supabase
                .from('areas')
                .select('id, nome')
                .eq('ativo', true)
                .order('nome')

            if (error) throw error
            setAreas(data || [])
        } catch (error) {
            console.error('Error fetching areas:', error)
        }
    }

    function handleOpenEditModal(professional) {
        setEditingStaff(professional)
        setEditStaff({
            nome: professional.nome,
            role: professional.role,
            ativo: professional.ativo
        })
        setShowEditModal(true)
    }

    async function handleAddStaff(e) {
        e.preventDefault()

        if (!newStaff.nome.trim() || !newStaff.email.trim()) {
            toast.error('Por favor, preencha todos os campos obrigatórios')
            return
        }

        if (!newStaff.area_id) {
            toast.error('Por favor, selecione uma área')
            return
        }

        setCreating(true)

        try {
            // Check for duplicate email
            const { data: existing } = await supabase
                .from('profissionais')
                .select('id')
                .eq('email', newStaff.email)
                .maybeSingle()


            if (existing) {
                toast.error('Um profissional com este email já existe')
                setCreating(false)
                return
            }

            // Chamar Edge Function para criar profissional
            const { data, error: functionError } = await supabase.functions.invoke('create-professional', {
                body: {
                    nome: newStaff.nome,
                    email: newStaff.email,
                    role: newStaff.role,
                    ativo: newStaff.ativo,
                    area_id: newStaff.area_id
                }
            })

            // Se houver erro na chamada HTTP
            if (functionError) {
                throw new Error(functionError.message || 'Erro ao chamar função de criação')
            }

            // Se a função retornou um erro de negócio
            if (data && typeof data === 'object' && 'error' in data) {
                throw new Error(data.error)
            }

            setNewStaff({ nome: '', email: '', role: 'profissional', ativo: true, area_id: '' })
            setShowAddModal(false)
            toast.success('Profissional adicionado com sucesso!')
            await fetchProfessionals()
        } catch (error) {
            console.error('Error adding staff:', error)
            toast.error('Falha ao adicionar profissional: ' + (error.message || 'Erro desconhecido'))
        } finally {
            setCreating(false)
        }
    }

    async function handleUpdateStaff(e) {
        e.preventDefault()

        if (!editStaff.nome.trim()) {
            toast.error('O nome não pode estar vazio')
            return
        }

        // Check if role is changing
        const roleChanged = editStaff.role !== editingStaff.role
        const statusChanged = editStaff.ativo !== editingStaff.ativo

        if (roleChanged) {
            if (!confirm(`Alterar função de "${editingStaff.role}" para "${editStaff.role}"? Isso afetará as permissões de acesso.`)) {
                return
            }
        }

        if (statusChanged && !editStaff.ativo) {
            if (!confirm(`Desativar ${editingStaff.nome}? Eles serão desconectados imediatamente.`)) {
                return
            }
        }

        setUpdating(true)

        try {
            const { error } = await supabase
                .from('profissionais')
                .update({
                    nome: editStaff.nome,
                    role: editStaff.role,
                    ativo: editStaff.ativo
                })
                .eq('id', editingStaff.id)

            if (error) throw error

            setShowEditModal(false)
            setEditingStaff(null)

            let message = 'Profissional atualizado com sucesso'
            if (roleChanged) message += '. Mudança de função terá efeito no próximo login.'
            if (statusChanged && !editStaff.ativo) message += '. Usuário desativado.'

            toast.success(message)
            await fetchProfessionals()
        } catch (error) {
            console.error('Error updating staff:', error)
            toast.error('Falha ao atualizar profissional: ' + error.message)
        } finally {
            setUpdating(false)
        }
    }

    async function handleDeleteStaff() {
        if (!editingStaff) return

        const confirmMessage = `ATENÇÃO: Você está prestes a EXCLUIR PERMANENTEMENTE o profissional "${editingStaff.nome}".

Esta ação irá:
• Remover completamente a conta de acesso
• Impedir que o usuário faça login no sistema
• Esta ação NÃO PODE SER DESFEITA

Digite "EXCLUIR" para confirmar:`

        const confirmation = prompt(confirmMessage)

        if (confirmation !== 'EXCLUIR') {
            toast.info('Exclusão cancelada')
            return
        }

        setDeleting(true)

        try {
            const { data, error: functionError } = await supabase.functions.invoke('delete-professional', {
                body: {
                    professional_id: editingStaff.id
                }
            })

            if (functionError) {
                throw new Error(functionError.message || 'Erro ao chamar função de exclusão')
            }

            if (data && typeof data === 'object' && 'error' in data) {
                throw new Error(data.error)
            }

            setShowEditModal(false)
            setEditingStaff(null)
            toast.success('Profissional excluído permanentemente')
            await fetchProfessionals()
        } catch (error) {
            console.error('Error deleting staff:', error)
            toast.error('Falha ao excluir profissional: ' + (error.message || 'Erro desconhecido'))
        } finally {
            setDeleting(false)
        }
    }

    // Filter professionals based on search
    const filteredProfessionals = professionals.filter(prof =>
        prof.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        prof.email.toLowerCase().includes(searchTerm.toLowerCase())
    )

    if (loading) {
        return (
            <div className="animation-fade-in">
                <div className="dashboard-header">
                    <h2>Profissionais</h2>
                </div>
                <div className="card loading-card">
                    <p className="loading-text-primary">Carregando equipe...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in">
            <div className="dashboard-header">
                <h2>Profissionais</h2>
                <button onClick={() => setShowAddModal(true)} className="btn btn-primary flex items-center gap-2">
                    <UserPlus size={18} />
                    Adicionar Membro
                </button>
            </div>

            <div className="tool-bar">
                <div className="search-box">
                    <Search size={18} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Buscar por nome ou email..."
                        className="search-input"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            </div>

            <div className="table-card">
                <div className="table-header">
                    <h3 className="table-title flex items-center gap-2">
                        <Users size={20} className="text-muted" />
                        {filteredProfessionals.length} {filteredProfessionals.length === 1 ? 'Membro' : 'Membros'}
                    </h3>
                </div>

                {filteredProfessionals.length === 0 ? (
                    <div className="empty-state">
                        <Users size={48} className="empty-icon" style={{ opacity: 0.2 }} />
                        <p className="empty-text">Nenhum profissional encontrado</p>
                        <button onClick={() => setShowAddModal(true)} className="btn btn-primary mt-4">
                            Adicionar Primeiro Membro
                        </button>
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Nome</th>
                                    <th>Email</th>
                                    <th>Função</th>
                                    <th>Status</th>
                                    <th style={{ textAlign: 'right' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredProfessionals.map(prof => (
                                    <tr key={prof.id}>
                                        <td>
                                            <div className="flex items-center gap-3">
                                                <div className="avatar-placeholder">
                                                    {prof.nome.charAt(0).toUpperCase()}
                                                </div>
                                                <span className="font-medium">{prof.nome}</span>
                                            </div>
                                        </td>
                                        <td className="text-muted">
                                            <div className="flex items-center gap-2">
                                                <Mail size={14} />
                                                {prof.email}
                                            </div>
                                        </td>
                                        <td>
                                            <span className={`badge ${prof.role === 'admin' ? 'badge-primary' : 'badge-neutral'} flex items-center gap-1 w-fit`}>
                                                {prof.role === 'admin' ? <Shield size={12} /> : <User size={12} />}
                                                {prof.role === 'admin' ? 'Admin' : 'Profissional'}
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`badge ${prof.ativo ? 'badge-success' : 'badge-danger'} flex items-center gap-1 w-fit`}>
                                                {prof.ativo ? <CheckCircle size={12} /> : <XCircle size={12} />}
                                                {prof.ativo ? 'Ativo' : 'Inativo'}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <button
                                                onClick={() => handleOpenEditModal(prof)}
                                                className="btn-icon"
                                                title="Editar"
                                            >
                                                <Edit size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Add Staff Modal */}
            {showAddModal && (
                <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Adicionar Membro</h3>
                            <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleAddStaff}>
                            <div className="modal-body">
                                <div className="input-group">
                                    <label htmlFor="nome">Nome Completo *</label>
                                    <div className="input-with-icon">
                                        <User size={18} className="input-icon" />
                                        <input
                                            id="nome"
                                            type="text"
                                            className="input pl-10"
                                            value={newStaff.nome}
                                            onChange={(e) => setNewStaff({ ...newStaff, nome: e.target.value })}
                                            placeholder="Ex: João Silva"
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="input-group">
                                    <label htmlFor="email">Email Corporativo *</label>
                                    <div className="input-with-icon">
                                        <Mail size={18} className="input-icon" />
                                        <input
                                            id="email"
                                            type="email"
                                            className="input pl-10"
                                            value={newStaff.email}
                                            onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                                            placeholder="joao@tvg.com"
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="input-group">
                                        <label htmlFor="role">Função</label>
                                        <div className="select-wrapper">
                                            <Shield size={18} className="select-icon" />
                                            <select
                                                id="role"
                                                className="input pl-10"
                                                value={newStaff.role}
                                                onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}
                                            >
                                                <option value="profissional">Profissional</option>
                                                <option value="admin">Administrador</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="input-group">
                                        <label htmlFor="area">Área / Setor *</label>
                                        <div className="select-wrapper">
                                            <Building2 size={18} className="select-icon" />
                                            <select
                                                id="area"
                                                className="input pl-10"
                                                value={newStaff.area_id}
                                                onChange={(e) => setNewStaff({ ...newStaff, area_id: e.target.value })}
                                                required
                                            >
                                                <option value="">Selecione...</option>
                                                {areas.map(area => (
                                                    <option key={area.id} value={area.id}>
                                                        {area.nome}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div className="input-group mt-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={newStaff.ativo}
                                            onChange={(e) => setNewStaff({ ...newStaff, ativo: e.target.checked })}
                                            style={{ width: '16px', height: '16px' }}
                                        />
                                        <span className="text-sm font-medium">Usuário Ativo</span>
                                    </label>
                                </div>

                                <div className="bg-blue-50 p-4 rounded-lg mt-4 border border-blue-100">
                                    <p className="text-sm text-blue-700 m-0 flex gap-2">
                                        <AlertTriangle size={16} />
                                        O usuário precisará se cadastrar com este email para acessar o sistema.
                                    </p>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                    className="btn btn-secondary"
                                    disabled={creating}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={creating}
                                >
                                    {creating ? 'Adicionando...' : 'Adicionar Membro'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Staff Modal */}
            {showEditModal && editingStaff && (
                <div className="modal-backdrop" onClick={() => setShowEditModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Editar Membro</h3>
                            <button className="modal-close" onClick={() => setShowEditModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleUpdateStaff}>
                            <div className="modal-body">
                                <div className="input-group">
                                    <label htmlFor="edit-nome">Nome Completo *</label>
                                    <div className="input-with-icon">
                                        <User size={18} className="input-icon" />
                                        <input
                                            id="edit-nome"
                                            type="text"
                                            className="input pl-10"
                                            value={editStaff.nome}
                                            onChange={(e) => setEditStaff({ ...editStaff, nome: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="input-group">
                                    <label htmlFor="edit-email">Email (Apenas Leitura)</label>
                                    <div className="input-with-icon">
                                        <Mail size={18} className="input-icon text-muted" />
                                        <input
                                            id="edit-email"
                                            type="email"
                                            className="input pl-10 bg-subtle cursor-not-allowed"
                                            value={editingStaff.email}
                                            disabled
                                        />
                                    </div>
                                    <p className="text-xs text-muted mt-1 ml-1">
                                        Emails não podem ser alterados por segurança
                                    </p>
                                </div>

                                <div className="input-group">
                                    <label htmlFor="edit-role">Função</label>
                                    <div className="select-wrapper">
                                        <Shield size={18} className="select-icon" />
                                        <select
                                            id="edit-role"
                                            className="input pl-10"
                                            value={editStaff.role}
                                            onChange={(e) => setEditStaff({ ...editStaff, role: e.target.value })}
                                        >
                                            <option value="profissional">Profissional</option>
                                            <option value="admin">Administrador</option>
                                        </select>
                                    </div>
                                    {editStaff.role !== editingStaff.role && (
                                        <p className="text-xs text-warning mt-1 ml-1 flex items-center gap-1">
                                            <AlertTriangle size={12} />
                                            Alterar a função mudará as permissões de acesso
                                        </p>
                                    )}
                                </div>

                                <div className="input-group mt-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={editStaff.ativo}
                                            onChange={(e) => setEditStaff({ ...editStaff, ativo: e.target.checked })}
                                            style={{ width: '16px', height: '16px' }}
                                        />
                                        <span className="text-sm font-medium">Usuário Ativo</span>
                                    </label>
                                    {!editStaff.ativo && editingStaff.ativo && (
                                        <p className="text-xs text-danger mt-1 ml-7">
                                            Desativar irá desconectar este usuário imediatamente
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="modal-footer justify-between">
                                <button
                                    type="button"
                                    onClick={handleDeleteStaff}
                                    className="btn btn-danger flex items-center gap-2"
                                    disabled={updating || deleting}
                                >
                                    <Trash2 size={16} />
                                    {deleting ? 'Excluindo...' : 'Excluir'}
                                </button>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowEditModal(false)}
                                        className="btn btn-secondary"
                                        disabled={updating || deleting}
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        disabled={updating || deleting}
                                    >
                                        {updating ? 'Atualizando...' : 'Salvar Alterações'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Professionals
