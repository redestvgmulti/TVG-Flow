
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Edit as EditIcon, Trash2, AlertOctagon } from 'lucide-react'
import { toast } from 'sonner'
import { professionalsService } from '../../../services/professionals'
import ProfessionalForm from './ProfessionalForm'
import ProfessionalCompanyLinks from '../../../components/ProfessionalCompanyLinks'

export default function ProfessionalEdit() {
    const { id } = useParams()
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [professional, setProfessional] = useState(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

    useEffect(() => {
        loadData()
    }, [id])

    async function loadData() {
        try {
            setLoading(true)
            const data = await professionalsService.getById(id)
            if (!data) throw new Error('Profissional não encontrado')
            setProfessional(data)
        } catch (error) {
            console.error('Error loading professional:', error)
            toast.error('Erro ao carregar dados do profissional')
            navigate('/admin/professionals')
        } finally {
            setLoading(false)
        }
    }

    const handleUpdate = async (formData) => {
        setIsSubmitting(true)
        try {
            // Remove sensitive/readonly fields before sending if needed, 
            // though service/API usually ignores them or we handle it there.
            // API update expects: { nome, role, ativo, area_id }
            const payload = {
                nome: formData.nome,
                role: formData.role,
                ativo: formData.ativo,
                area_id: formData.area_id
            }

            await professionalsService.update(id, payload)
            toast.success('Dados atualizados com sucesso!')
            navigate('/admin/professionals')
        } catch (error) {
            console.error('Error updating professional:', error)
            toast.error(error.message || 'Falha ao atualizar')
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleDelete = async () => {
        const confirmMessage = prompt(
            `ATENÇÃO: Digite "DELETAR" para confirmar a exclusão PERMANENTE de ${professional.nome}.`
        )

        if (confirmMessage !== 'DELETAR') return

        setIsDeleting(true)
        try {
            await professionalsService.delete(id)
            toast.success('Profissional excluído permanentemente.')
            navigate('/admin/professionals')
        } catch (error) {
            console.error('Error deleting:', error)
            toast.error(error.message || 'Erro ao excluir profissional')
        } finally {
            setIsDeleting(false)
        }
    }

    if (loading) {
        return <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-text-secondary)' }}>Carregando dados...</div>
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 fade-in p-6 md:p-0">
            {/* Header */}
            <div className="dashboard-header flex items-center gap-4">
                <button
                    onClick={() => navigate('/admin/professionals')}
                    className="btn-icon bg-white hover:bg-slate-50 text-muted hover:text-primary transition-colors"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h2 className="flex items-center gap-2">
                        Editar Profissional
                    </h2>
                    <p className="text-muted mt-1">Atualize as informações e permissões.</p>
                </div>
            </div>

            {/* Main Form */}
            <div className="card">
                <ProfessionalForm
                    initialData={professional}
                    onSubmit={handleUpdate}
                    onCancel={() => navigate('/admin/professionals')}
                    onDelete={handleDelete}
                    isSubmitting={isSubmitting}
                    isEditMode={true}
                />
            </div>

            {/* Vínculos com Empresas (Architecture Refactor) */}
            <div className="card">
                <ProfessionalCompanyLinks professionalId={id} />
            </div>

            {/* Danger Zone */}
            <div style={{ background: 'var(--color-danger-bg)', borderRadius: '16px', border: '1px solid #FCA5A5', padding: '24px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                <div>
                    <h3 style={{ color: 'var(--color-danger)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                        <AlertOctagon size={18} />
                        Zona de Perigo
                    </h3>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', marginTop: '6px', marginBottom: 0 }}>
                        A exclusão é irreversível e removerá todo o histórico de acesso deste usuário.
                    </p>
                </div>
                <button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="btn btn-danger"
                >
                    {isDeleting ? 'Excluindo...' : (
                        <>
                            <Trash2 size={16} /> Excluir Profissional
                        </>
                    )}
                </button>
            </div>
        </div>
    )
}
