
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
            toast.success('Profissional criado com sucesso!')
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
            <div className="flex items-center gap-4 mb-8">
                <button
                    onClick={() => navigate('/admin/professionals')}
                    className="p-2 hover:bg-white/50 rounded-lg transition-colors text-slate-500 hover:text-slate-800"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <UserPlus className="text-blue-600" />
                        Novo Profissional
                    </h1>
                    <p className="text-slate-500">Preencha os dados abaixo para cadastrar um novo membro na equipe.</p>
                </div>
            </div>

            {/* Form Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-lg p-6 md:p-8">
                <ProfessionalForm
                    onSubmit={handleCreate}
                    onCancel={() => navigate('/admin/professionals')}
                    isSubmitting={isSubmitting}
                />
            </div>
        </div>
    )
}
