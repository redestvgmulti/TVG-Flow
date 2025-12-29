import { supabase } from './supabase';
import { resolveTenantContext } from '../utils/resolveTenantContext';

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
      empresas!tarefas_empresa_id_fkey (id, nome),
      profissionais (id, nome),
      departamentos (id, nome, cor_hex)
    `)
        .single();

    if (error) throw error;
    return data;
};

/**
 * Criar OS por Função (Architecture Refactor)
 * Chama Edge Function para distribuir microtarefas
 */
export const createOS = async (payload) => {
    // payload: { empresa_id, titulo, descricao, deadline_at, funcoes }
    const { data, error } = await supabase.functions.invoke('create-os-by-function', {
        body: payload
    })

    if (error) throw new Error(error.message || 'Erro ao criar OS')
    if (data?.error) throw new Error(data.error)

    return data
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
      empresas!tarefas_empresa_id_fkey (id, nome),
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
      empresas!tarefas_empresa_id_fkey (id, nome),
      profissionais (id, nome),
      departamentos (id, nome, cor_hex)
    `)
        .eq('id', taskId)
        .single();

    if (error) throw error;
    return data;
};

// ... (previous code)

/**
 * Buscar tarefas com filtros
 */
export const getAllTasks = async (filters = {}) => {
    let query = supabase
        .from('tarefas')
        .select(`
      *,
      empresas!tarefas_empresa_id_fkey (id, nome),
      profissionais (id, nome),
      departamentos (id, nome, cor_hex)
    `)
        .order('deadline', { ascending: true }); // Mais urgentes primeiro

    if (filters.status) {
        query = query.eq('status', filters.status);
    }

    if (filters.cliente_id) {
        query = query.eq('cliente_id', filters.cliente_id);
    }

    if (filters.profissional_id) {
        query = query.eq('profissional_id', filters.profissional_id);
    }

    if (filters.departamento_id) {
        query = query.eq('departamento_id', filters.departamento_id);
    }

    if (filters.search) {
        query = query.ilike('titulo', `%${filters.search}%`);
    }

    const { data, error } = await query;
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
 * Buscar clientes (empresas operacionais)
 * CRITICAL: Must respect tenant isolation
 */
export const getClients = async (searchQuery = '') => {
    const { mode, tenantId, role } = await resolveTenantContext();

    // Super admins don't see operational companies
    if (mode === 'super_admin') {
        return [];
    }

    // Staff cannot list companies
    if (role === 'staff') {
        throw new Error('Operation not allowed for staff');
    }

    let query = supabase
        .from('empresas')
        .select('id, nome')
        .eq('empresa_tipo', 'operacional')
        .eq('tenant_id', tenantId)
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
