
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Users, UserPlus, Search, Mail, CheckCircle, XCircle, Edit, X, Copy
} from 'lucide-react'
import { toast } from 'sonner'
import { professionalsService } from '../../../services/professionals'
import ProfessionalForm from './ProfessionalForm'
import { SkeletonTable } from '../../../components/Skeleton'
import '../../../styles/professionals.css'

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
                <SkeletonTable rows={5} cols={4} />
            </div>
        )
    }

    return (
        <div className="professionals-page animation-fade-in">
            {/* Header */}
            <div className="professionals-header">
                <div className="professionals-header__content">
                    <h2>Gestão de Profissionais</h2>
                    <p>Gerencie o acesso e permissões da sua equipe.</p>
                </div>
                <button
                    onClick={() => {
                        setInviteLink(null)
                        setCreatedName('')
                        setIsCreateModalOpen(true)
                    }}
                    className="btn btn-primary"
                >
                    <UserPlus size={18} />
                    Novo Profissional
                </button>
            </div>

            {/* Barra de busca premium (mesma das Tarefas) + contador integrado */}
            <div className="admin-tasks-filterbar" style={{ marginTop: 0, marginBottom: '1.5rem' }}>
                <div className="filterbar-search">
                    <Search size={15} />
                    <input
                        type="text"
                        aria-label="Buscar por nome ou e-mail"
                        placeholder="Buscar por nome ou e-mail..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="professionals-count">
                    {searchTerm
                        ? <><strong>{filtered.length}</strong> de {professionals.length} membros</>
                        : <><strong>{professionals.length}</strong> membros</>}
                </div>
                {searchTerm && (
                    <button type="button" className="filterbar-clear" style={{ marginLeft: 0 }} onClick={() => setSearchTerm('')}>
                        <X size={13} /> Limpar
                    </button>
                )}
            </div>

            {/* Table Card */}
            <div className="table-card">
                <div className="table-header border-b border-slate-100">
                    <h3 className="table-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Users size={18} style={{ color: 'var(--color-text-tertiary)' }} />
                        <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>Equipe Cadastrada</span>
                    </h3>
                </div>

                {filtered.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon" style={{ opacity: 0.2 }}><Users size={64} /></div>
                        <p className="empty-text" style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>Nenhum profissional encontrado</p>
                        <p style={{ color: 'var(--color-text-tertiary)', marginBottom: '1.5rem' }}>Tente ajustar sua busca ou adicione um novo membro.</p>
                        {searchTerm && (
                            <button onClick={() => setSearchTerm('')} className="btn btn-ghost" style={{ color: 'var(--color-primary)' }}>
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
                                    <th style={{ padding: '1.5rem', textAlign: 'left' }}>Ativo em</th>
                                    <th style={{ padding: '1.5rem', textAlign: 'left' }}>Status</th>
                                    <th style={{ padding: '1.5rem', paddingRight: '2rem', textAlign: 'right' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(prof => (
                                    <tr key={prof.id}>
                                        <td style={{ padding: '1.5rem', paddingLeft: '2rem' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{prof.nome}</div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '13px', color: 'var(--color-text-tertiary)' }}>
                                                    <Mail size={14} />
                                                    {prof.email}
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: '1.5rem' }}>
                                            <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                Ativo em <strong>{prof.company_count || 0}</strong> {prof.company_count === 1 ? 'empresa' : 'empresas'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1.5rem' }}>
                                            <span className={`ap-chip no-dot ${prof.ativo ? 'tone-success' : 'tone-neutral'}`}>
                                                {prof.ativo ? <CheckCircle size={12} /> : <XCircle size={12} />}
                                                {prof.ativo ? 'Ativo' : 'Inativo'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1.5rem', paddingRight: '2rem', textAlign: 'right' }}>
                                            <button
                                                onClick={() => handleEditClick(prof)}
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
                        <div className="modal-header">
                            <div>
                                <h3 style={{ color: 'var(--color-danger)', fontWeight: 700 }}>Confirmar Exclusão</h3>
                                <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>Esta ação não pode ser desfeita</p>
                            </div>
                        </div>

                        <div className="modal-body">
                            <div style={{ background: 'var(--color-danger-bg)', border: '1px solid #FCA5A5', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
                                <p style={{ color: 'var(--color-text-primary)', fontWeight: 500, marginBottom: '8px' }}>
                                    Tem certeza que deseja excluir <strong>{selectedProfessional.nome}</strong>?
                                </p>
                                <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', margin: 0 }}>
                                    Esta ação removerá permanentemente o acesso ao sistema e não pode ser desfeita.
                                </p>
                            </div>

                            <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
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
                                    className="btn btn-danger"
                                >
                                    {isSubmitting ? 'Desativando...' : 'Sim, desativar'}
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
                                <div className="space-y-5">
                                    {/* Título de sucesso */}
                                    <div>
                                        <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                                            Profissional Criado!
                                        </h3>
                                        <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '6px', marginBottom: 0 }}>
                                            Envie o link de acesso abaixo para <strong style={{ color: 'var(--color-text-primary)' }}>{createdName}</strong>.
                                        </p>
                                    </div>

                                    {/* Feedback + Botão Copiar */}
                                    <div style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '12px',
                                        padding: '16px',
                                        backgroundColor: 'var(--color-success-bg)',
                                        borderRadius: '10px',
                                        border: '1px solid var(--color-success)'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                            <CheckCircle size={16} style={{ color: 'var(--color-success)', marginTop: '2px', flexShrink: 0 }} />
                                            <div style={{ flex: 1 }}>
                                                <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-success)', fontWeight: 600 }}>
                                                    Link de convite gerado.
                                                </p>
                                                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                                    Use o botão abaixo para copiar e enviar ao usuário.
                                                </p>
                                            </div>
                                        </div>

                                        <button
                                            onClick={copyToClipboard}
                                            className="btn btn-primary"
                                            style={{ width: '100%' }}
                                        >
                                            <Copy size={16} />
                                            Copiar link de convite
                                        </button>

                                        <p style={{ margin: 0, fontSize: '11px', color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                                            O link expira automaticamente por segurança.
                                        </p>
                                    </div>
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
