import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import TaskForm from '../../../components/forms/TaskForm'

export default function NewOS() {
    const navigate = useNavigate()

    return (
        <div className="max-w-3xl mx-auto space-y-8 fade-in p-6 md:p-0">
            {/* Header */}
            <div className="page-header-premium">
                <button
                    onClick={() => navigate('/admin')}
                    className="btn btn-ghost p-2 -ml-2 text-slate-500 hover:text-slate-800"
                    title="Voltar"
                >
                    <ArrowLeft size={24} strokeWidth={2} />
                </button>
                <div className="pt-1">
                    <h2 className="page-title">
                        Nova Ordem de Serviço
                    </h2>
                    <p className="page-subtitle">
                        Preencha os dados e definições da demanda
                    </p>
                </div>
            </div>

            <div className="card-premium-decision">
                <TaskForm
                    onSuccess={(result) => {
                        // Optional: Navigate to detail of first created task if possible, 
                        // or just back to list with success toast (already handled by form)
                        navigate('/admin/tasks')
                    }}
                    onCancel={() => navigate('/admin/tasks')}
                />
            </div>
        </div>
    )
}
