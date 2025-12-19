
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Users, UserPlus, Search, Mail, Shield, User, CheckCircle, XCircle, Edit
} from 'lucide-react'
import { toast } from 'sonner'
import { professionalsService } from '../../../services/professionals'
import ProfessionalForm from './ProfessionalForm'

export default function ProfessionalsList() {
    const navigate = useNavigate()
    const [professionals, setProfessionals] = useState([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')

    // Modal State
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

    // Create & Success State
    const [inviteLink, setInviteLink] = useState(null)
    const [createdName, setCreatedName] = useState('')

    const [selectedProfessional, setSelectedProfessional] = useState(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    useEffect(() => {
        loadData()
    }, [])

    async function loadData() {
        try {
            setLoading(true)
            const data = await professionalsService.list()
            setProfessionals(data || [])
        } catch (error) {
            console.error('Failed to load professionals', error)
            toast.error('Erro ao carregar lista de profissionais')
        } finally {
            setLoading(false)
        }
    }

    const handleEditClick = (professional) => {
        setSelectedProfessional(professional)
        setIsEditModalOpen(true)
    }

    const handleCloseModal = () => {
        setIsEditModalOpen(false)
        setSelectedProfessional(null)
    }

    const handleUpdate = async (formData) => {
        setIsSubmitting(true)
        try {
            await professionalsService.update(selectedProfessional.id, formData)
            toast.success('Profissional atualizado com sucesso!')
            handleCloseModal()
            await loadData()
        } catch (error) {
            console.error('Error updating professional:', error)
            toast.error('Falha ao atualizar profissional')
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleDeleteClick = () => {
        setIsDeleteModalOpen(true)
    }

    const handleDeleteConfirm = async () => {
        if (!selectedProfessional) return

        setIsSubmitting(true)
        try {
            await professionalsService.delete(selectedProfessional.id)
            toast.success('Profissional excluído com sucesso!')
            setIsDeleteModalOpen(false)
            handleCloseModal()
            await loadData()
        } catch (error) {
            console.error('Error deleting professional:', error)
            toast.error(error.message || 'Falha ao excluir profissional')
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleDeleteCancel = () => {
        setIsDeleteModalOpen(false)
    }

    // Create Handler
    const handleCreate = async (formData) => {
        setIsSubmitting(true)
        try {
            const response = await professionalsService.create(formData)

            if (response.inviteLink) {
                setInviteLink(response.inviteLink)
                setCreatedName(formData.nome)
                toast.success('Profissional criado! Copie o link de convite.')
                await loadData() // Reload list in background
            } else {
                toast.success('Profissional criado com sucesso!')
                setIsCreateModalOpen(false)
                await loadData()
            }
        } catch (error) {
            console.error('Error creating professional:', error)
            toast.error(error.message || 'Falha ao criar profissional')
        } finally {
            setIsSubmitting(false)
        }
    }

    const copyToClipboard = () => {
        navigator.clipboard.writeText(inviteLink)
        toast.success('Link copiado!')
    }

    const handleCloseCreateModal = () => {
        setIsCreateModalOpen(false)
        setInviteLink(null)
        setCreatedName('')
    }

    const filtered = professionals.filter(p =>
        p.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.email.toLowerCase().includes(searchTerm.toLowerCase())
    )

    if (loading) {
        return (
            <div className="animation-fade-in">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                    <div>
                        <h2>Gestão de Profissionais</h2>
                    </div>
                </div>
                <div className="card loading-card">
                    <p className="loading-text-primary">Carregando equipe...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in space-y-6">
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Gestão de Profissionais</h2>
                    <p className="text-muted mt-1">Gerencie o acesso e permissões da sua equipe.</p>
                </div>
                <button
                    onClick={() => {
                        setInviteLink(null)
                        setCreatedName('')
                        setIsCreateModalOpen(true)
                    }}
                    className="btn btn-primary flex items-center gap-2 shadow-lg shadow-blue-200/50"
                >
                    <UserPlus size={18} />
                    Novo Profissional
                </button>
            </div>

            {/* Toolbar - Detached Elements */}
            <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="w-full max-w-md" style={{ position: 'relative' }}>
                    {!searchTerm && (
                        <Search
                            size={18}
                            style={{
                                position: 'absolute',
                                left: '12px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                pointerEvents: 'none',
                                color: '#94a3b8' // text-slate-400
                            }}
                        />
                    )}
                    <input
                        type="text"
                        placeholder="Buscar por nome ou e-mail..."
                        className="input"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%',
                            paddingLeft: !searchTerm ? '40px' : '16px'
                        }}
                    />
                </div>
                <div className="text-sm text-slate-500 font-medium bg-slate-100 px-4 py-2 rounded-full border border-slate-200">
                    Mostrando <strong>{filtered.length}</strong> membros
                </div>
            </div>

            {/* Table Card */}
            <div className="table-card">
                <div className="table-header border-b border-slate-100">
                    <h3 className="table-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Users size={18} className="text-muted" />
                        <span className="font-semibold text-slate-700">Equipe Cadastrada</span>
                    </h3>
                </div>

                {filtered.length === 0 ? (
                    <div className="empty-state py-12">
                        <div className="empty-icon mb-4" style={{ opacity: 0.1 }}><Users size={64} /></div>
                        <p className="empty-text text-lg font-medium text-slate-600">Nenhum profissional encontrado</p>
                        <p className="text-slate-400 mb-6">Tente ajustar sua busca ou adicione um novo membro.</p>
                        {searchTerm && (
                            <button onClick={() => setSearchTerm('')} className="btn btn-ghost text-primary hover:bg-blue-50">
                                Limpar busca
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th style={{ padding: '1.5rem', paddingLeft: '2rem', textAlign: 'left' }}>Profissional</th>
                                    <th style={{ padding: '1.5rem', textAlign: 'left' }}>Função</th>
                                    <th style={{ padding: '1.5rem', textAlign: 'left' }}>Departamento</th>
                                    <th style={{ padding: '1.5rem', textAlign: 'left' }}>Status</th>
                                    <th style={{ padding: '1.5rem', paddingRight: '2rem', textAlign: 'right' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(prof => (
                                    <tr key={prof.id} className="hover:bg-slate-50/80 transition-all border-b border-slate-50 last:border-0">
                                        <td style={{ padding: '1.5rem', paddingLeft: '2rem' }}>
                                            <div className="flex flex-col gap-1.5">
                                                <div className="font-bold text-slate-800 text-base">{prof.nome}</div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} className="text-sm text-slate-500">
                                                    <Mail size={14} className="text-slate-400" />
                                                    {prof.email}
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: '1.5rem' }}>
                                            <span className={`badge ${prof.roles === 'admin' ? 'badge-primary' : 'badge-warning'} gap-1.5 px-3 py-1.5 text-xs ring-1 ring-inset ${prof.role === 'admin' ? 'ring-blue-100' : 'ring-yellow-100'}`}>
                                                {prof.role === 'admin' ? <Shield size={12} /> : <User size={12} />}
                                                {prof.role === 'admin' ? 'Administrador' : 'Profissional'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1.5rem' }}>
                                            <span className="text-sm font-medium text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
                                                {prof.areas?.nome || <span className="text-slate-400 italic font-normal">Sem área</span>}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1.5rem' }}>
                                            <span className={`badge ${prof.ativo ? 'badge-success' : 'badge-danger'} gap-1.5 px-3 py-1.5 ring-1 ring-inset ${prof.ativo ? 'ring-green-100' : 'ring-red-100'}`}>
                                                {prof.ativo ? <CheckCircle size={12} /> : <XCircle size={12} />}
                                                {prof.ativo ? 'Ativo' : 'Inativo'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1.5rem', paddingRight: '2rem', textAlign: 'right' }}>
                                            <button
                                                onClick={() => handleEditClick(prof)}
                                                className="btn-icon p-2.5 hover:bg-white hover:text-blue-600 hover:shadow-md border border-transparent hover:border-slate-100 rounded-lg transition-all text-slate-400 bg-slate-50"
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

            {/* Edit Modal */}
            {isEditModalOpen && (
                <div className="modal-backdrop" onClick={handleCloseModal}>
                    <div
                        className="modal"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="modal-header">
                            <div>
                                <h3>Editar Profissional</h3>
                                <p className="text-sm text-slate-500 mt-1">Atualize as informações do membro da equipe.</p>
                            </div>
                            <button
                                onClick={handleCloseModal}
                                className="modal-close"
                            >
                                <XCircle size={20} />
                            </button>
                        </div>

                        <div className="modal-body">
                            <ProfessionalForm
                                initialData={selectedProfessional}
                                onSubmit={handleUpdate}
                                onCancel={handleCloseModal}
                                onDelete={handleDeleteClick}
                                isSubmitting={isSubmitting}
                                isEditMode={true}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {isDeleteModalOpen && selectedProfessional && (
                <div className="modal-backdrop" onClick={handleDeleteCancel}>
                    <div
                        className="modal max-w-md"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="modal-header border-b border-red-100 bg-red-50">
                            <div>
                                <h3 className="text-red-800 font-bold">Confirmar Exclusão</h3>
                                <p className="text-sm text-red-600 mt-1">Esta ação não pode ser desfeita</p>
                            </div>
                        </div>

                        <div className="modal-body">
                            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                                <p className="text-slate-700 font-medium mb-2">
                                    Tem certeza que deseja excluir <strong>{selectedProfessional.nome}</strong>?
                                </p>
                                <p className="text-sm text-slate-600">
                                    Esta ação removerá permanentemente o acesso ao sistema e não pode ser desfeita.
                                </p>
                            </div>

                            <div className="flex gap-3 justify-end">
                                <button
                                    onClick={handleDeleteCancel}
                                    disabled={isSubmitting}
                                    className="btn btn-ghost"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleDeleteConfirm}
                                    disabled={isSubmitting}
                                    className="btn shadow-lg shadow-red-200/50 hover:shadow-xl hover:shadow-red-300/60 transition-all"
                                    style={{
                                        backgroundColor: '#dc2626',
                                        color: 'white',
                                        borderColor: '#dc2626'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#b91c1c'}
                                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#dc2626'}
                                >
                                    {isSubmitting ? 'Excluindo...' : 'Sim, Excluir'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Create Professional Modal */}
            {isCreateModalOpen && (
                <div className="modal-backdrop" onClick={handleCloseCreateModal}>
                    <div
                        className="modal max-w-2xl bg-white/90 backdrop-blur-md shadow-2xl border border-white/20"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="modal-header border-b border-gray-100 flex items-center justify-between p-6">
                            <div>
                                <h3 className="text-xl font-bold text-gray-800">
                                    {inviteLink ? 'Profissional Criado!' : 'Novo Profissional'}
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">
                                    {inviteLink
                                        ? 'Envie o link de acesso abaixo.'
                                        : 'Preencha os dados do novo membro.'}
                                </p>
                            </div>
                            <button
                                onClick={handleCloseCreateModal}
                                className="btn-icon text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-2 transition-all"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="modal-body p-6">
                            {inviteLink ? (
                                <div className="text-center space-y-6 animate-in fade-in zoom-in duration-300">
                                    <div className="inline-flex justify-center items-center w-20 h-20 rounded-full bg-green-50 mb-2 border border-green-100 shadow-sm">
                                        <UserPlus size={36} className="text-green-600" />
                                    </div>

                                    <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-6 text-left w-full overflow-hidden">
                                        <p className="text-gray-600 mb-4 text-sm leading-relaxed">
                                            Como não há sistema de e-mail configurado, você precisa enviar este link manualmente para <strong className="text-gray-900">{createdName}</strong>.
                                        </p>

                                        <div className="relative group">
                                            <div className="bg-white p-4 rounded-lg border border-gray-200 font-mono text-xs text-gray-600 break-all shadow-inner select-all w-full leading-relaxed">
                                                {inviteLink}
                                            </div>
                                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <span className="text-xs bg-gray-800 text-white px-2 py-1 rounded">Clique para selecionar</span>
                                            </div>
                                        </div>
                                    </div>

                                    <button
                                        onClick={copyToClipboard}
                                        className="btn btn-primary w-full py-3 text-base flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 hover:-translate-y-0.5 transition-all"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
                                        Copiar Link de Convite
                                    </button>
                                </div>
                            ) : (
                                <ProfessionalForm
                                    onSubmit={handleCreate}
                                    onCancel={handleCloseCreateModal}
                                    isSubmitting={isSubmitting}
                                    hideCancelButton={true}
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
