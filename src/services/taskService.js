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

// ==================== Arquivos ====================

/**
 * Upload de arquivo
 */
export const uploadTaskFile = async (taskId, file) => {
    // Upload para Supabase Storage
    const fileExt = file.name.split('.').pop();
    const fileName = `${taskId}/${Date.now()}.${fileExt}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
        .from('task-files')
        .upload(fileName, file);

    if (uploadError) throw uploadError;

    // Registrar no banco
    const { data, error } = await supabase
        .from('arquivos_tarefas')
        .insert([{
            tarefa_id: taskId,
            nome_arquivo: file.name,
            caminho_storage: uploadData.path,
            tamanho_bytes: file.size,
        }])
        .select()
        .single();

    if (error) throw error;
    return data;
};

/**
 * Buscar arquivos da tarefa
 */
export const getTaskFiles = async (taskId) => {
    const { data, error } = await supabase
        .from('arquivos_tarefas')
        .select('*')
        .eq('tarefa_id', taskId)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
};

/**
 * Deletar arquivo
 */
export const deleteTaskFile = async (fileId, storagePath) => {
    // Deletar do storage
    const { error: storageError } = await supabase.storage
        .from('task-files')
        .remove([storagePath]);

    if (storageError) throw storageError;

    // Deletar do banco
    const { error } = await supabase
        .from('arquivos_tarefas')
        .delete()
        .eq('id', fileId);

    if (error) throw error;
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
