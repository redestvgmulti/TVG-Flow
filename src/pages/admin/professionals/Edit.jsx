
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Edit as EditIcon, Trash2, AlertOctagon } from 'lucide-react'
import { toast } from 'sonner'
import { professionalsService } from '../../../services/professionals'
import ProfessionalForm from './ProfessionalForm'

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
        return <div className="p-10 text-center text-slate-500">Carregando dados...</div>
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 fade-in p-6 md:p-0">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button
                    onClick={() => navigate('/admin/professionals')}
                    className="p-2 hover:bg-white/50 rounded-lg transition-colors text-slate-500 hover:text-slate-800"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <EditIcon className="text-blue-600" />
                        Editar Profissional
                    </h1>
                    <p className="text-slate-500">Atualize as informações e permissões.</p>
                </div>
            </div>

            {/* Main Form */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-6 md:p-8">
                <ProfessionalForm
                    initialData={professional}
                    onSubmit={handleUpdate}
                    onCancel={() => navigate('/admin/professionals')}
                    isSubmitting={isSubmitting}
                    isEditMode={true}
                />
            </div>

            {/* Danger Zone */}
            <div className="bg-red-50 rounded-xl border border-red-100 p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                    <h3 className="text-red-800 font-bold flex items-center gap-2">
                        <AlertOctagon size={18} />
                        Zona de Perigo
                    </h3>
                    <p className="text-red-600/80 text-sm mt-1">
                        A exclusão é irreversível e removerá todo o histórico de acesso deste usuário.
                    </p>
                </div>
                <button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="px-4 py-2 bg-white border border-red-200 text-red-600 hover:bg-red-600 hover:text-white rounded-lg transition-colors font-medium flex items-center gap-2 shadow-sm"
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
