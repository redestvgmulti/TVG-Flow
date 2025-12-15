import { STATUS, STATUS_LABELS, STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS } from './constants';
import { isOverdue, isDueToday, isDeadlineApproaching } from './dateUtils';

/**
 * Determina o status visual de uma tarefa baseado no deadline
 */
export const getTaskStatusColor = (task) => {
    if (!task) return STATUS_COLORS[STATUS.PENDING];

    if (task.status === STATUS.COMPLETED) {
        return STATUS_COLORS[STATUS.COMPLETED];
    }

    if (task.status === STATUS.OVERDUE || isOverdue(task.deadline)) {
        return STATUS_COLORS[STATUS.OVERDUE];
    }

    if (isDueToday(task.deadline)) {
        return STATUS_COLORS[STATUS.IN_PROGRESS];
    }

    if (isDeadlineApproaching(task.deadline)) {
        return 'var(--warning-500)';
    }

    return STATUS_COLORS[task.status] || STATUS_COLORS[STATUS.PENDING];
};

/**
 * Retorna o label do status
 */
export const getStatusLabel = (status) => {
    return STATUS_LABELS[status] || status;
};

/**
 * Retorna a cor do status
 */
export const getStatusColor = (status) => {
    return STATUS_COLORS[status] || STATUS_COLORS[STATUS.PENDING];
};

/**
 * Retorna o label da prioridade
 */
export const getPriorityLabel = (priority) => {
    return PRIORITY_LABELS[priority] || priority;
};

/**
 * Retorna a cor da prioridade
 */
export const getPriorityColor = (priority) => {
    return PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium;
};

/**
 * Retorna um emoji baseado no status da tarefa
 */
export const getTaskStatusEmoji = (task) => {
    if (!task) return '📋';

    if (task.status === STATUS.COMPLETED) return '✅';
    if (task.status === STATUS.OVERDUE || isOverdue(task.deadline)) return '🔴';
    if (isDueToday(task.deadline)) return '🟠';
    if (isDeadlineApproaching(task.deadline)) return '⚠️';

    return '🟢';
};

/**
 * Filtra tarefas por status
 */
export const filterTasksByStatus = (tasks, status) => {
    if (!tasks || !Array.isArray(tasks)) return [];
    return tasks.filter(task => task.status === status);
};

/**
 * Filtra tarefas do dia atual
 */
export const filterTasksForToday = (tasks) => {
    if (!tasks || !Array.isArray(tasks)) return [];
    return tasks.filter(task => isDueToday(task.deadline));
};

/**
 * Filtra tarefas atrasadas
 */
export const filterOverdueTasks = (tasks) => {
    if (!tasks || !Array.isArray(tasks)) return [];
    return tasks.filter(task =>
        task.status !== STATUS.COMPLETED && isOverdue(task.deadline)
    );
};

/**
 * Ordena tarefas por deadline (mais próximo primeiro)
 */
export const sortTasksByDeadline = (tasks) => {
    if (!tasks || !Array.isArray(tasks)) return [];
    return [...tasks].sort((a, b) => {
        const dateA = new Date(a.deadline);
        const dateB = new Date(b.deadline);
        return dateA - dateB;
    });
};

/**
 * Ordena tarefas por prioridade
 */
export const sortTasksByPriority = (tasks) => {
    if (!tasks || !Array.isArray(tasks)) return [];

    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };

    return [...tasks].sort((a, b) => {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
};
