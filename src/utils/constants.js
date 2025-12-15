// Constantes de prioridade
export const PRIORITY = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    URGENT: 'urgent',
};

export const PRIORITY_LABELS = {
    [PRIORITY.LOW]: 'Baixa',
    [PRIORITY.MEDIUM]: 'Média',
    [PRIORITY.HIGH]: 'Alta',
    [PRIORITY.URGENT]: 'Urgente',
};

export const PRIORITY_COLORS = {
    [PRIORITY.LOW]: 'var(--neutral-500)',
    [PRIORITY.MEDIUM]: 'var(--primary-500)',
    [PRIORITY.HIGH]: 'var(--warning-500)',
    [PRIORITY.URGENT]: 'var(--danger-500)',
};

// Constantes de status
export const STATUS = {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed',
    OVERDUE: 'overdue',
};

export const STATUS_LABELS = {
    [STATUS.PENDING]: 'Pendente',
    [STATUS.IN_PROGRESS]: 'Em Andamento',
    [STATUS.COMPLETED]: 'Concluída',
    [STATUS.OVERDUE]: 'Atrasada',
};

export const STATUS_COLORS = {
    [STATUS.PENDING]: 'var(--neutral-500)',
    [STATUS.IN_PROGRESS]: 'var(--primary-500)',
    [STATUS.COMPLETED]: 'var(--success-500)',
    [STATUS.OVERDUE]: 'var(--danger-500)',
};

// Constantes de roles
export const ROLES = {
    ADMIN: 'admin',
    PROFISSIONAL: 'profissional',
};

export const ROLE_LABELS = {
    [ROLES.ADMIN]: 'Administrador',
    [ROLES.PROFISSIONAL]: 'Profissional',
};

// Timezone padrão
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

// Configurações de notificação
export const NOTIFICATION_TYPES = {
    TASK_CREATED: 'task_created',
    TASK_ASSIGNED: 'task_assigned',
    TASK_DEADLINE_APPROACHING: 'task_deadline_approaching',
    TASK_OVERDUE: 'task_overdue',
    TASK_COMPLETED: 'task_completed',
    TASK_REQUEST_RECEIVED: 'task_request_received',
};

// Tempo antes do deadline para enviar notificação (em horas)
export const DEADLINE_WARNING_HOURS = 2;

// Intervalo de atualização do countdown (em milissegundos)
export const COUNTDOWN_UPDATE_INTERVAL = 1000;

// Formato de data padrão
export const DATE_FORMAT = 'dd/MM/yyyy';
export const DATETIME_FORMAT = 'dd/MM/yyyy HH:mm';
export const TIME_FORMAT = 'HH:mm';
