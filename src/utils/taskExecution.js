import { supabase } from '../services/supabase'

/**
 * Complete a micro task via Edge Function
 * @param {string} microTaskId - The micro task ID to complete
 * @returns {Promise<object>} - The response data
 */
export async function completeMicroTask(microTaskId) {
    const { data, error } = await supabase.functions.invoke('complete-micro-task', {
        body: { micro_task_id: microTaskId }
    })

    if (error) throw error

    if (!data || !data.success) {
        throw new Error(data?.error || 'Falha ao concluir micro tarefa')
    }

    return data
}

/**
 * Update micro task status directly
 * @param {string} microTaskId - The micro task ID
 * @param {string} status - The new status (pendente, em_execucao, bloqueada, devolvida)
 */
export async function updateMicroTaskStatus(microTaskId, status) {
    const validStatuses = ['pendente', 'em_execucao', 'concluida', 'bloqueada', 'devolvida']

    if (!validStatuses.includes(status)) {
        throw new Error(`Status inválido: ${status}. Valores permitidos: ${validStatuses.join(', ')}`)
    }

    const { error } = await supabase
        .from('tarefas_micro')
        .update({ status })
        .eq('id', microTaskId)

    if (error) throw error
}

/**
 * Load all professionals from a workflow (excluding current user)
 * @param {string} macroTaskId - The macro task ID
 * @param {string} currentUserId - The current user's ID to exclude
 * @returns {Promise<Array>} - Array of professionals with their functions
 */
export async function loadWorkflowProfessionals(macroTaskId, currentUserId) {
    const { data, error } = await supabase
        .from('tarefas_micro')
        .select(`
            profissional_id,
            funcao,
            profissionais!inner (
                id,
                nome
            )
        `)
        .eq('tarefa_id', macroTaskId)
        .neq('profissional_id', currentUserId)

    if (error) throw error
    return data || []
}

/**
 * Return a micro task to another professional via Edge Function
 * @param {object} payload - { micro_task_id, to_profissional_id, motivo }
 * @returns {Promise<object>} - The response data
 */
export async function returnMicroTask(payload) {
    const { data, error } = await supabase.functions.invoke('return-micro-task', {
        body: payload
    })

    if (error) throw error

    if (!data || !data.success) {
        throw new Error(data?.error || 'Falha ao devolver tarefa')
    }

    return data
}
