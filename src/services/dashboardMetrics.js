/**
 * Dashboard Metrics Service
 * 
 * FONTE DA VERDADE para todas as métricas do Dashboard.
 * 
 * REGRAS CANÔNICAS:
 * - Total: exclui 'cancelada'
 * - Ativas: 'pendente' + 'em_execucao'
 * - Concluídas: 'concluida'
 * - Atrasadas: 'atrasada' OU (pendente/em_execucao com deadline vencido)
 * - Canceladas: 'cancelada'
 * - Profissionais: apenas ativos
 * 
 * IMPORTANTE:
 * - Usa queries agregadas (count) - NÃO carrega dados completos
 * - Português é língua oficial dos status
 * - Inglês tratado apenas como compatibilidade legada
 */

import { supabase } from './supabase'

/**
 * Helper Defensivo: Get Current Date at Midnight
 * Returns a new Date object representing the start of the current day in local time.
 * @returns {Date}
 */
function getStartOfToday() {
    const now = new Date();
    return new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0, 0, 0, 0
    );
}

/**
 * Helper Defensivo: Falha Segura
 * Returns a zeroed metrics object to prevent UI crashes.
 */
function getSafeEmptyMetrics() {
    return {
        totalTasks: 0,
        activeTasks: 0,
        completedTasks: 0,
        overdueTasks: 0,
        overdueActive: 0,
        dueToday: 0,
        dueIn48h: 0,
        unassigned: 0,
        cancelledTasks: 0,
        professionalsCount: 0
    }
}

/**
 * Get all dashboard metrics using aggregated queries
 * @returns {Promise<Object>} Metrics object with all counts
 */
export async function getDashboardMetrics() {
    try {
        const now = new Date().toISOString()

        // 1. Define Local Date Helpers (Defensive Fix)
        const startOfToday = getStartOfToday()

        const endOfToday = new Date(startOfToday)
        endOfToday.setHours(23, 59, 59, 999)

        const in48Hours = new Date(Date.now() + 48 * 60 * 60 * 1000)

        // Create promise array for parallel execution
        const promises = [
            // 0: Total de Tarefas (exclui canceladas)
            supabase
                .from('tarefas')
                .select('*', { count: 'exact', head: true })
                .neq('status', 'cancelada'),

            // 1: Tarefas Ativas (pendente + em_execucao)
            supabase
                .from('tarefas')
                .select('*', { count: 'exact', head: true })
                .in('status', ['pendente', 'em_execucao']),

            // 2: Tarefas Concluídas
            supabase
                .from('tarefas')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'concluida'),

            // 3: Atrasadas = qualquer tarefa NÃO concluída/cancelada com deadline vencido
            supabase
                .from('tarefas')
                .select('*', { count: 'exact', head: true })
                .not('status', 'eq', 'concluida')
                .not('status', 'eq', 'cancelada')
                .lt('deadline', now),

            // 4: Tarefas Canceladas
            supabase
                .from('tarefas')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'cancelada'),

            // 5: Ativas Atrasadas (subset de ativas com deadline vencido)
            supabase
                .from('tarefas')
                .select('*', { count: 'exact', head: true })
                .in('status', ['pendente', 'em_execucao'])
                .lt('deadline', now),

            // 6: Vencem Hoje
            supabase
                .from('tarefas')
                .select('*', { count: 'exact', head: true })
                .not('status', 'eq', 'concluida')
                .not('status', 'eq', 'cancelada')
                .gte('deadline', startOfToday.toISOString())
                .lte('deadline', endOfToday.toISOString()),

            // 7: Vencem em 48h
            supabase
                .from('tarefas')
                .select('*', { count: 'exact', head: true })
                .not('status', 'eq', 'concluida')
                .not('status', 'eq', 'cancelada')
                .gt('deadline', now)
                .lte('deadline', in48Hours.toISOString()),

            // 8: Sem Responsável (RPC)
            supabase.rpc('count_unassigned_tasks'),

            // 9: Profissionais Ativos
            supabase
                .from('profissionais')
                .select('*', { count: 'exact', head: true })
                .eq('ativo', true)
        ]

        // Execute all queries in parallel
        const results = await Promise.all(promises)

        // Destructure results (handling potential nulls/errors inline if needed, but throwing on strict error per original logic)
        const [
            { count: totalTasks, error: totalError },
            { count: activeTasks, error: activeError },
            { count: completedTasks, error: completedError },
            { count: overdueTasks, error: overdueError },
            { count: cancelledTasks, error: cancelledError },
            { count: overdueActive, error: overdueActiveError },
            { count: dueToday, error: dueTodayError },
            { count: dueIn48h, error: dueIn48hError },
            { data: unassignedCount, error: unassignedError },
            { count: professionalsCount, error: profsError }
        ] = results

        // Check for errors
        if (totalError) throw totalError
        if (activeError) throw activeError
        if (completedError) throw completedError
        if (overdueError) throw overdueError
        if (cancelledError) throw cancelledError
        if (overdueActiveError) throw overdueActiveError
        if (dueTodayError) throw dueTodayError
        if (dueIn48hError) throw dueIn48hError
        if (unassignedError) throw unassignedError
        if (profsError) throw profsError

        const metrics = {
            // KPIs Primários (mutuamente exclusivos)
            totalTasks: totalTasks || 0,
            activeTasks: activeTasks || 0,
            completedTasks: completedTasks || 0,

            // Indicador Secundário (overlay temporal)
            overdueTasks: overdueTasks || 0,

            // Métricas Acionáveis
            overdueActive: overdueActive || 0,
            dueToday: dueToday || 0,
            dueIn48h: dueIn48h || 0,
            unassigned: unassignedCount || 0,

            // Outras
            cancelledTasks: cancelledTasks || 0,
            professionalsCount: professionalsCount || 0
        }

        // Dev-only logging com validação matemática
        if (import.meta.env.DEV) {
            console.log('[Dashboard Metrics]', metrics)
            console.log('[Validation] Ativas + Concluídas =', metrics.activeTasks + metrics.completedTasks, '| Total =', metrics.totalTasks)

            // Validação: Ativas + Concluídas deve ser igual ao Total
            if (metrics.activeTasks + metrics.completedTasks !== metrics.totalTasks) {
                console.warn('⚠️ [Validation] Inconsistência detectada na soma de métricas!')
            }
        }

        return metrics

    } catch (error) {
        console.error('[Dashboard Metrics] Fatal error:', error)
        return getSafeEmptyMetrics()
    }
}

/**
 * Get recent tasks for dashboard display
 * @param {number} limit - Number of recent tasks to fetch (default: 5)
 * @returns {Promise<Array>} Array of recent tasks
 */
export async function getRecentTasks(limit = 6) {
    try {
        const now = new Date().toISOString()
        const shortly = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24h from now

        // 1. Fetch Urgent Tasks (Overdue OR Due Soon) sorted by Deadline ASC
        // We want: deadline < shortly (includes overdue and today/tomorrow)
        // AND status not completed/concluded/cancelled.
        const { data: urgentTasks, error: urgentError } = await supabase
            .from('tarefas')
            .select('id, status, titulo, deadline, priority, created_at, assigned_to, drive_link')
            .not('status', 'in', '("completed","concluída","concluida","cancelada")')
            .lt('deadline', shortly) // Anything due before tomorrow 24h
            .order('deadline', { ascending: true }) // Most urgent first (oldest deadline)
            .limit(limit)

        if (urgentError) throw urgentError

        let finalTasks = urgentTasks || []

        // 2. If we have space, fill with Recent tasks (Classic logic)
        if (finalTasks.length < limit) {
            const needed = limit - finalTasks.length
            const existingIds = finalTasks.map(t => t.id)

            let query = supabase
                .from('tarefas')
                .select('id, status, titulo, deadline, priority, created_at, assigned_to, drive_link')
                .not('status', 'in', '("completed","concluída","concluida","cancelada")')
                .order('created_at', { ascending: false }) // Newest first
                .limit(needed)

            if (existingIds.length > 0) {
                query = query.not('id', 'in', `(${existingIds.join(',')})`)
            }

            const { data: recentFillers, error: recentError } = await query

            if (recentError) throw recentError

            if (recentFillers) {
                finalTasks = [...finalTasks, ...recentFillers]
            }
        }

        return finalTasks

    } catch (error) {
        console.error('[Dashboard Metrics] Error fetching recent tasks:', error)
        throw error
    }
}

