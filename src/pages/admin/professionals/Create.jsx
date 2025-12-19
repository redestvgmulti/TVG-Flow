
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { professionalsService } from '../../../services/professionals'
import ProfessionalForm from './ProfessionalForm'

export default function ProfessionalCreate() {
    const navigate = useNavigate()
    const [inviteLink, setInviteLink] = useState(null)
    const [createdName, setCreatedName] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    const handleCreate = async (formData) => {
        setIsSubmitting(true)
        try {
            const response = await professionalsService.create(formData)

            if (response.inviteLink) {
                setInviteLink(response.inviteLink)
                setCreatedName(formData.nome)
                toast.success('Profissional criado! Copie o link de convite.')
            } else {
                toast.success('Profissional criado com sucesso!')
                navigate('/admin/professionals')
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
        toast.success('Link copiado para a área de transferência!')
    }

    if (inviteLink) {
        return (
            <div className="max-w-4xl mx-auto space-y-6 fade-in p-6 md:p-0">
                <div className="card p-8 text-center bg-white shadow-lg rounded-xl border border-gray-100">
                    <div className="inline-flex justify-center items-center w-16 h-16 rounded-full bg-green-100 mb-6">
                        <UserPlus size={32} className="text-green-600" />
                    </div>

                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Profissional Criado!</h2>
                    <p className="text-gray-500 mb-6">
                        Como não há sistema de email configurado, você precisa enviar este link manualmente para <strong>{createdName}</strong>.
                    </p>

                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-6 break-all font-mono text-sm text-gray-600 select-all">
                        {inviteLink}
                    </div>

                    <div className="flex flex-col sm:flex-row justify-center gap-3">
                        <button
                            onClick={copyToClipboard}
                            className="btn btn-primary flex items-center justify-center gap-2"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
                            Copiar Link
                        </button>
                        <button
                            onClick={() => navigate('/admin/professionals')}
                            className="btn btn-secondary"
                        >
                            Voltar para Lista
                        </button>
                    </div>
                </div>
            </div>
        )
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
