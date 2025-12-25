import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import TaskForm from '../../../components/forms/TaskForm'
import '../../../styles/admin-forms.css'

export default function NewOS() {
    const navigate = useNavigate()

    return (
        <div className="admin-page-container">
            {/* Header */}
            <div className="admin-page-header">
                <button
                    onClick={() => navigate('/admin')}
                    className="admin-back-btn"
                    title="Voltar"
                >
                    <ArrowLeft size={24} strokeWidth={2} />
                </button>
                <div className="admin-page-title-group">
                    <h2 className="admin-page-title">
                        Nova Ordem de Serviço
                    </h2>
                    <p className="admin-page-subtitle">
                        Preencha os dados e definições da demanda
                    </p>
                </div>
            </div>

            <div className="card-premium">
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
