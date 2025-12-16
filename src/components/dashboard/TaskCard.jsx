import React from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getTimeRemaining, isOverdue } from '../../utils/dateUtils';
// import './TaskCard.css';

const TaskCard = ({ task, onClick, compact = false }) => {
    const timeRemaining = getTimeRemaining(task.deadline);
    const overdue = isOverdue(task.deadline);
    const statusClass = overdue ? 'overdue' : task.status;

    const getPriorityLabel = (priority) => {
        const labels = {
            alta: '🔴 Alta',
            media: '🟡 Média',
            baixa: '🟢 Baixa',
        };
        return labels[priority] || priority;
    };

    const formatCountdown = () => {
        if (overdue) {
            const timeAgo = formatDistanceToNow(new Date(task.deadline), {
                locale: ptBR,
                addSuffix: true,
            });
            return `Atrasada ${timeAgo}`;
        }

        const { hours, minutes } = timeRemaining;
        if (hours > 24) {
            const days = Math.floor(hours / 24);
            return `${days}d ${hours % 24}h`;
        }
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    };

    const getCountdownColor = () => {
        if (overdue) return 'var(--danger-600)';
        const { hours } = timeRemaining;
        if (hours < 2) return 'var(--danger-600)';
        if (hours < 6) return 'var(--warning-600)';
        return 'var(--success-600)';
    };

    if (compact) {
        return (
            <div
                className={`task-card task-card-compact status-${statusClass}`}
                onClick={() => onClick && onClick(task)}
            >
                <div className="task-card-header">
                    <h4 className="task-title-compact">{task.titulo}</h4>
                    <span
                        className="task-countdown-compact"
                        style={{ color: getCountdownColor() }}
                    >
                        {formatCountdown()}
                    </span>
                </div>
                <div className="task-meta-compact">
                    <span>{task.clientes?.nome || 'Sem cliente'}</span>
                    <span className="task-separator">•</span>
                    <span>{task.profissionais?.nome || 'Não atribuída'}</span>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`task-card status-${statusClass}`}
            onClick={() => onClick && onClick(task)}
        >
            <div className="task-card-header">
                <span className={`priority-badge priority-${task.prioridade}`}>
                    {getPriorityLabel(task.prioridade)}
                </span>
                <span
                    className={`task-countdown ${overdue ? 'countdown-urgent' : ''}`}
                >
                    {formatCountdown()}
                </span>
            </div>

            <h3 className="task-title">{task.titulo}</h3>

            {task.descricao && (
                <p className="task-description">{task.descricao}</p>
            )}

            <div className="task-meta">
                <span className="task-client">
                    {task.clientes?.nome || 'Sem cliente'}
                </span>
                <span className="task-separator">•</span>
                <span className="task-assignee">
                    {task.profissionais?.nome || 'Não atribuída'}
                </span>
            </div>

            {task.departamentos && (
                <div
                    className="task-department"
                    style={{
                        backgroundColor: `${task.departamentos.cor_hex}20`,
                        color: task.departamentos.cor_hex,
                        borderColor: `${task.departamentos.cor_hex}40`,
                    }}
                >
                    {task.departamentos.nome}
                </div>
            )}
        </div>
    );
};

export default TaskCard;
