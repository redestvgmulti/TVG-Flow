import { supabase } from './supabase';

// ==================== CRUD de Tarefas ====================

/**
 * Criar nova tarefa
 */
export const createTask = async (taskData) => {
    const { data, error } = await supabase
        .from('tarefas')
        .insert([{
            titulo: taskData.titulo,
            descricao: taskData.descricao,
            cliente_id: taskData.cliente_id,
            profissional_id: taskData.profissional_id,
            departamento_id: taskData.departamento_id,
            prioridade: taskData.prioridade,
            deadline: taskData.deadline,
            research_link: taskData.research_link || null,
            final_link: taskData.final_link || null,
            status: 'pendente',
        }])
        .select(`
      *,
      clientes (id, nome),
      profissionais (id, nome),
      departamentos (id, nome, cor_hex)
    `)
        .single();

    if (error) throw error;
    return data;
};

/**
 * Atualizar tarefa
 */
export const updateTask = async (taskId, updates) => {
    const { data, error } = await supabase
        .from('tarefas')
        .update(updates)
        .eq('id', taskId)
        .select(`
      *,
      clientes (id, nome),
      profissionais (id, nome),
      departamentos (id, nome, cor_hex)
    `)
        .single();

    if (error) throw error;
    return data;
};

/**
 * Deletar tarefa
 */
export const deleteTask = async (taskId) => {
    const { error } = await supabase
        .from('tarefas')
        .delete()
        .eq('id', taskId);

    if (error) throw error;
};

/**
 * Buscar tarefa por ID
 */
export const getTaskById = async (taskId) => {
    const { data, error } = await supabase
        .from('tarefas')
        .select(`
      *,
      clientes (id, nome),
      profissionais (id, nome),
      departamentos (id, nome, cor_hex)
    `)
        .eq('id', taskId)
        .single();

    if (error) throw error;
    return data;
};

// ==================== Buscar Dados para Formulários ====================

/**
 * Buscar profissionais ativos
 */
export const getActiveProfessionals = async () => {
    const { data, error } = await supabase
        .from('profissionais')
        .select('id, nome, departamento_id, departamentos(nome, cor_hex)')
        .eq('ativo', true)
        .order('nome');

    if (error) throw error;
    return data;
};

/**
 * Buscar clientes
 */
export const getClients = async (searchQuery = '') => {
    let query = supabase
        .from('clientes')
        .select('id, nome')
        .order('nome');

    if (searchQuery) {
        query = query.ilike('nome', `%${searchQuery}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
};

/**
 * Buscar departamentos
 */
export const getDepartments = async () => {
    const { data, error } = await supabase
        .from('departamentos')
        .select('id, nome, cor_hex')
        .order('nome');

    if (error) throw error;
    return data;
};

// ==================== Validações ====================

/**
 * Validar dados de tarefa
 */
export const validateTaskData = (taskData) => {
    const errors = {};

    if (!taskData.titulo || taskData.titulo.trim().length < 3) {
        errors.titulo = 'Título deve ter no mínimo 3 caracteres';
    }

    if (!taskData.cliente_id) {
        errors.cliente_id = 'Cliente é obrigatório';
    }

    if (!taskData.profissional_id) {
        errors.profissional_id = 'Profissional é obrigatório';
    }

    if (!taskData.departamento_id) {
        errors.departamento_id = 'Departamento é obrigatório';
    }

    if (!taskData.prioridade) {
        errors.prioridade = 'Prioridade é obrigatória';
    }

    if (!taskData.deadline) {
        errors.deadline = 'Deadline é obrigatório';
    } else {
        const deadlineDate = new Date(taskData.deadline);
        if (deadlineDate < new Date()) {
            errors.deadline = 'Deadline não pode ser no passado';
        }
    }

    // Validar URLs se fornecidas
    const urlPattern = /^https?:\/\/.+/i;

    if (taskData.research_link && !urlPattern.test(taskData.research_link)) {
        errors.research_link = 'Link de pesquisa deve ser uma URL válida';
    }

    if (taskData.final_link && !urlPattern.test(taskData.final_link)) {
        errors.final_link = 'Link final deve ser uma URL válida';
    }

    return {
        isValid: Object.keys(errors).length === 0,
        errors,
    };
};

/**
 * Validar mudança de status
 */
export const validateStatusChange = (currentStatus, newStatus) => {
    // Não pode voltar de concluída para pendente
    if (currentStatus === 'concluida' && newStatus !== 'concluida') {
        return {
            isValid: false,
            error: 'Não é possível reabrir uma tarefa concluída',
        };
    }

    return { isValid: true };
};
