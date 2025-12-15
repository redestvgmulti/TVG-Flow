import { format, formatDistanceToNow, isPast, differenceInHours, differenceInMinutes, differenceInSeconds } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * Formata uma data para o formato brasileiro
 */
export const formatDate = (date, formatStr = 'dd/MM/yyyy') => {
    if (!date) return '';
    return format(new Date(date), formatStr, { locale: ptBR });
};

/**
 * Formata uma data e hora para o formato brasileiro
 */
export const formatDateTime = (date) => {
    if (!date) return '';
    return format(new Date(date), 'dd/MM/yyyy HH:mm', { locale: ptBR });
};

/**
 * Formata apenas a hora
 */
export const formatTime = (date) => {
    if (!date) return '';
    return format(new Date(date), 'HH:mm', { locale: ptBR });
};

/**
 * Retorna a distância relativa até agora (ex: "há 2 horas")
 */
export const formatRelativeTime = (date) => {
    if (!date) return '';
    return formatDistanceToNow(new Date(date), {
        addSuffix: true,
        locale: ptBR
    });
};

/**
 * Verifica se uma data já passou
 */
export const isOverdue = (deadline) => {
    if (!deadline) return false;
    return isPast(new Date(deadline));
};

/**
 * Verifica se uma tarefa vence hoje
 */
export const isDueToday = (deadline) => {
    if (!deadline) return false;
    const now = new Date();
    const deadlineDate = new Date(deadline);

    return (
        deadlineDate.getDate() === now.getDate() &&
        deadlineDate.getMonth() === now.getMonth() &&
        deadlineDate.getFullYear() === now.getFullYear()
    );
};

/**
 * Calcula o tempo restante até o deadline
 * Retorna objeto com horas, minutos e segundos
 */
export const getTimeRemaining = (deadline) => {
    if (!deadline) return null;

    const now = new Date();
    const deadlineDate = new Date(deadline);

    if (isPast(deadlineDate)) {
        return { hours: 0, minutes: 0, seconds: 0, isOverdue: true };
    }

    const totalSeconds = differenceInSeconds(deadlineDate, now);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return { hours, minutes, seconds, isOverdue: false };
};

/**
 * Formata o tempo restante como string (HH:MM:SS)
 */
export const formatTimeRemaining = (deadline) => {
    const remaining = getTimeRemaining(deadline);
    if (!remaining) return '';

    if (remaining.isOverdue) return 'Atrasada';

    const { hours, minutes, seconds } = remaining;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

/**
 * Verifica se o deadline está próximo (menos de X horas)
 */
export const isDeadlineApproaching = (deadline, hoursThreshold = 2) => {
    if (!deadline) return false;
    const now = new Date();
    const deadlineDate = new Date(deadline);

    if (isPast(deadlineDate)) return false;

    const hoursRemaining = differenceInHours(deadlineDate, now);
    return hoursRemaining <= hoursThreshold;
};

/**
 * Converte uma data para o timezone de São Paulo
 */
export const toSaoPauloTime = (date) => {
    if (!date) return null;

    // Cria uma data no timezone de São Paulo
    const dateObj = new Date(date);
    return new Date(dateObj.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
};

/**
 * Formata input de datetime-local para o formato do Supabase
 */
export const formatDateTimeForDB = (dateTimeLocalValue) => {
    if (!dateTimeLocalValue) return null;

    // datetime-local retorna no formato: "2024-12-15T14:30"
    // Precisamos converter para ISO string com timezone
    const date = new Date(dateTimeLocalValue);
    return date.toISOString();
};

/**
 * Formata data do DB para input datetime-local
 */
export const formatDateTimeForInput = (dbDateTime) => {
    if (!dbDateTime) return '';

    const date = new Date(dbDateTime);
    // Formato esperado: "2024-12-15T14:30"
    return format(date, "yyyy-MM-dd'T'HH:mm");
};
