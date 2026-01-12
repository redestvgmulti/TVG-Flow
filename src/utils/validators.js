/**
 * Valid statuses for 'tarefas' table (Postgres ENUM/Check Constraint)
 * Based on Migration 1000_normalize_task_status.sql
 */
export const VALID_TAREFA_STATUS = [
    'pendente',
    'em_execucao',
    'concluida',
    'atrasada',
    // 'cancelada', // Available in some contexts but not in the main check constraint?
    // 'bloqueada', // Only for micro-tasks usually?
    // 'devolvida'  // Only for micro-tasks usually?
];

/**
 * Validates if the status is allowed for the 'tarefas' table.
 * @param {string} status 
 * @returns {boolean}
 */
export function isValidStatus(status) {
    if (!status) return false;
    // Strict validation against the core checklist
    // Note: Micro-tasks might have other statuses like 'bloqueada', 'devolvida' 
    // but the 'tarefas' (macro) table usually sticks to the main workflow.
    // However, if the DB check constraint allows them, we should add them.
    // Migration 1000 says: CHECK (status IN ('pendente', 'em_execucao', 'concluida', 'atrasada'))
    // So ONLY these 4 are allowed for 'tarefas' table.
    return VALID_TAREFA_STATUS.includes(status);
}

/**
 * Normalizes legacy or UI status strings to the valid database enum.
 * @param {string} status 
 * @returns {string} Valid status or original if no mapping found
 */
export function normalizeStatus(status) {
    if (!status) return status;

    switch (status.toLowerCase()) {
        case 'pending':
        case 'pendente': // UI Label sometimes matches
            return 'pendente';

        case 'in_progress':
        case 'em_progresso': // Legacy plumbing
        case 'em andamento': // UI Label
            return 'em_execucao';

        case 'completed':
        case 'concluida':
        case 'concluída': // UI Label
            return 'concluida';

        case 'overdue':
        case 'atrasada':
            return 'atrasada';

        default:
            return status;
    }
}
