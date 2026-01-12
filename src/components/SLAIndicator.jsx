import { Clock, CheckCircle, AlertTriangle } from 'lucide-react'
import '../styles/sla-indicators.css'

function SLAIndicator({ deadlineAt, status, startedAt, finishedAt, size = 'medium' }) {
    // 🔒 Se não tem deadline, retornar vazio
    if (!deadlineAt) {
        return null
    }

    const deadline = new Date(deadlineAt)
    const now = new Date()
    const isCompleted = status === 'concluida'
    const isOverdue = now > deadline && !isCompleted
    const isNearDeadline = now > new Date(deadline - 4 * 60 * 60 * 1000) && !isOverdue && !isCompleted

    let slaClass = 'no-prazo'
    let icon = <Clock size={14} />
    let label = 'No Prazo'

    if (isCompleted) {
        slaClass = 'concluida'
        icon = <CheckCircle size={14} />
        label = 'Concluída'
    } else if (isOverdue) {
        slaClass = 'atrasada'
        icon = <AlertTriangle size={14} />
        const horasAtraso = Math.round((now - deadline) / (1000 * 60 * 60))
        label = `Atrasada (${horasAtraso}h)`
    } else if (isNearDeadline) {
        slaClass = 'proximo-prazo'
        icon = <Clock size={14} />
        label = 'Próximo ao Prazo'
    }

    return (
        <span className={`sla-badge ${slaClass} sla-badge-${size}`}>
            {icon}
            {label}
        </span>
    )
}

export default SLAIndicator
