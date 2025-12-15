import { supabase } from './supabase';
import { startOfDay, endOfDay, addDays, endOfWeek, parseISO } from 'date-fns';

/**
 * Dashboard Service
 * Serviços de dados para o Master Admin Dashboard
 */

/**
 * Busca métricas principais do dashboard
 */
export const getDashboardMetrics = async () => {
    try {
        const today = startOfDay(new Date());
        const tomorrow = addDays(today, 1);
        const weekEnd = endOfWeek(new Date());

        // Tarefas de hoje
        const { data: tasksToday, error: todayError } = await supabase
            .from('tarefas')
            .select('id')
            .gte('deadline', today.toISOString())
            .lt('deadline', tomorrow.toISOString())
            .neq('status', 'concluida');

        if (todayError) throw todayError;

        // Tarefas atrasadas
        const { data: overdueTasks, error: overdueError } = await supabase
            .from('tarefas')
            .select(`
        *,
        profissionais(id, nome),
        clientes(nome),
        departamentos(nome, cor_hex)
      `)
            .lt('deadline', today.toISOString())
            .neq('status', 'completed')
            .order('deadline', { ascending: true });

        if (overdueError) throw overdueError;

        // Tarefas concluídas hoje
        const { data: completedToday, error: completedError } = await supabase
            .from('tarefas')
            .select('id')
            .eq('status', 'concluida')
            .gte('updated_at', today.toISOString());

        if (completedError) throw completedError;

        // Tarefas da semana
        const { data: tasksWeek, error: weekError } = await supabase
            .from('tarefas')
            .select('id')
            .gte('deadline', today.toISOString())
            .lte('deadline', weekEnd.toISOString())
            .neq('status', 'concluida');

        if (weekError) throw weekError;

        // Profissionais ativos
        const { data: activePros, error: prosError } = await supabase
            .from('profissionais')
            .select('id')
            .eq('ativo', true);

        if (prosError) throw prosError;

        return {
            tasksToday: tasksToday?.length || 0,
            overdueTasks: overdueTasks || [],
            completedToday: completedToday?.length || 0,
            tasksThisWeek: tasksWeek?.length || 0,
            activeProfessionals: activePros?.length || 0,
        };
    } catch (error) {
        console.error('Erro ao buscar métricas do dashboard:', error);
        throw error;
    }
};

/**
 * Busca tarefas de hoje com detalhes
 */
export const getTodayTasks = async () => {
    try {
        const today = startOfDay(new Date());
        const tomorrow = addDays(today, 1);

        const { data, error } = await supabase
            .from('tarefas')
            .select(`
        *,
        profissionais(id, nome),
        clientes(nome),
        departamentos(nome, cor_hex)
      `)
            .gte('deadline', today.toISOString())
            .lt('deadline', tomorrow.toISOString())
            .order('deadline', { ascending: true })
            .order('prioridade', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (error) {
        console.error('Erro ao buscar tarefas de hoje:', error);
        throw error;
    }
};

/**
 * Busca carga de trabalho da equipe
 */
export const getTeamWorkload = async () => {
    try {
        const { data: professionals, error: prosError } = await supabase
            .from('profissionais')
            .select(`
        id,
        nome,
        departamento_id,
        departamentos(nome, cor_hex)
      `)
            .eq('ativo', true)
            .order('nome');

        if (prosError) throw prosError;

        // Para cada profissional, buscar suas tarefas
        const workloadPromises = professionals.map(async (prof) => {
            const today = startOfDay(new Date());

            // Tarefas ativas
            const { data: activeTasks } = await supabase
                .from('tarefas')
                .select('id, status, deadline')
                .eq('profissional_id', prof.id)
                .neq('status', 'concluida');

            // Tarefas atrasadas
            const overdueTasks = activeTasks?.filter(
                (task) => new Date(task.deadline) < today
            ) || [];

            return {
                ...prof,
                activeTasks: activeTasks?.length || 0,
                overdueTasks: overdueTasks.length,
                isOverloaded: (activeTasks?.length || 0) > 5, // Mais de 5 tarefas = sobrecarregado
            };
        });

        const workload = await Promise.all(workloadPromises);
        return workload;
    } catch (error) {
        console.error('Erro ao buscar carga da equipe:', error);
        throw error;
    }
};

/**
 * Busca estatísticas rápidas para um período
 */
export const getQuickStats = async (startDate, endDate) => {
    try {
        const { data, error } = await supabase
            .from('tarefas')
            .select('status, prioridade')
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString());

        if (error) throw error;

        const stats = {
            total: data?.length || 0,
            completed: data?.filter((t) => t.status === 'concluida').length || 0,
            pending: data?.filter((t) => t.status === 'pendente').length || 0,
            inProgress: data?.filter((t) => t.status === 'em_andamento').length || 0,
            highPriority: data?.filter((t) => t.prioridade === 'alta').length || 0,
        };

        return stats;
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        throw error;
    }
};

/**
 * Atualiza status de uma tarefa
 */
export const updateTaskStatus = async (taskId, newStatus) => {
    try {
        const updateData = {
            status: newStatus,
            updated_at: new Date().toISOString(),
        };

        if (newStatus === 'concluida') {
            updateData.completed_at = new Date().toISOString();
        }

        const { data, error } = await supabase
            .from('tarefas')
            .update(updateData)
            .eq('id', taskId)
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Erro ao atualizar status da tarefa:', error);
        throw error;
    }
};

/**
 * Reatribui uma tarefa para outro profissional
 */
export const reassignTask = async (taskId, newAssigneeId) => {
    try {
        const { data, error } = await supabase
            .from('tarefas')
            .update({
                profissional_id: newAssigneeId,
                updated_at: new Date().toISOString(),
            })
            .eq('id', taskId)
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('Erro ao reatribuir tarefa:', error);
        throw error;
    }
};
