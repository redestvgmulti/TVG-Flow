
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { professionalsService } from '../../../services/professionals'
import ProfessionalForm from './ProfessionalForm'

export default function ProfessionalCreate() {
    const navigate = useNavigate()
    const [isSubmitting, setIsSubmitting] = useState(false)

    const handleCreate = async (formData) => {
        setIsSubmitting(true)
        try {
            await professionalsService.create(formData)
            toast.success('Convite enviado com sucesso! O funcionário receberá um e-mail.')
            navigate('/admin/professionals')
        } catch (error) {
            console.error('Error creating professional:', error)
            toast.error(error.message || 'Falha ao criar profissional')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6 fade-in p-6 md:p-0">
            {/* Header */}
            <div className="dashboard-header flex items-center gap-4 mb-8">
                <button
                    onClick={() => navigate('/admin/professionals')}
                    className="btn-icon bg-white hover:bg-slate-50 text-muted hover:text-primary transition-colors"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h2>Novo Profissional</h2>
                    <p className="text-muted mt-1">Preencha os dados abaixo para cadastrar um novo membro na equipe.</p>
                </div>
            </div>

            {/* Form Card */}
            <div className="card">
                <ProfessionalForm
                    onSubmit={handleCreate}
                    onCancel={() => navigate('/admin/professionals')}
                    isSubmitting={isSubmitting}
                />
            </div>
        </div>
    )
}
