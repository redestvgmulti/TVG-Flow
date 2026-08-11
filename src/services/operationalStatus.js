import { supabase } from './supabase'

const ACTIVE_TASK_STATUSES = [
    'pendente', 'em_execucao', 'em_progresso', 'in_progress',
    'pending', 'atrasada', 'overdue', 'devolvida'
]
const BLOCKED_TASK_STATUSES = ['bloqueada', 'blocked']

function pluralize(count, singular, plural) {
    return count === 1 ? singular : plural
}

// RLS is deliberately the scope boundary: the client never broadens this query.
export async function getOperationalStatus() {
    const now = new Date()
    const next48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000)
    const [criticalResult, blockedResult, upcomingResult] = await Promise.all([
        supabase.from('tarefas').select('*', { count: 'exact', head: true })
            .in('status', ACTIVE_TASK_STATUSES).lt('deadline', now.toISOString()),
        supabase.from('tarefas').select('*', { count: 'exact', head: true })
            .in('status', BLOCKED_TASK_STATUSES),
        supabase.from('tarefas').select('*', { count: 'exact', head: true })
            .in('status', ACTIVE_TASK_STATUSES)
            .gte('deadline', now.toISOString()).lte('deadline', next48Hours.toISOString())
    ])

    const error = criticalResult.error || blockedResult.error || upcomingResult.error
    if (error) throw error

    const critical = criticalResult.count || 0
    const blocked = blockedResult.count || 0
    const upcoming = upcomingResult.count || 0

    if (critical > 0) return {
        tone: 'critical', message: `${critical} ${pluralize(critical, 'tarefa crítica pendente', 'tarefas críticas pendentes')}`,
        critical, blocked, upcoming
    }
    if (blocked > 0) return {
        tone: 'critical', message: `${blocked} ${pluralize(blocked, 'tarefa bloqueada', 'tarefas bloqueadas')}`,
        critical, blocked, upcoming
    }
    if (upcoming > 0) return {
        tone: 'attention', message: `${upcoming} ${pluralize(upcoming, 'tarefa vence em até 48h', 'tarefas vencem em até 48h')}`,
        critical, blocked, upcoming
    }
    return { tone: 'healthy', message: 'Nenhuma tarefa crítica pendente', critical, blocked, upcoming }
}
