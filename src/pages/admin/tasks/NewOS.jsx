import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import TaskForm from '../../../components/forms/TaskForm'

export default function NewOS() {
    const navigate = useNavigate()

    return (
        <div className="max-w-3xl mx-auto space-y-8 fade-in p-6 md:p-0">
            {/* Header */}
            <div className="dashboard-header flex items-center gap-4">
                <button
                    onClick={() => navigate('/admin/tasks')}
                    className="btn-icon bg-white hover:bg-slate-50 text-muted hover:text-primary transition-colors"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h2 className="flex items-center gap-2">
                        Nova Ordem de Serviço
                    </h2>
                    <p className="text-muted mt-1">Distribuição automática baseada em Funções.</p>
                </div>
            </div>

            <div className="card">
                <TaskForm
                    onSuccess={() => navigate('/admin/tasks')}
                    onCancel={() => navigate('/admin/tasks')}
                />
            </div>
        </div>
    )
}
