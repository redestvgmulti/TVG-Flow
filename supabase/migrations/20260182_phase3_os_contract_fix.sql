-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: FASE 3 - NEW CONTRACT OS (CREATE RPC V2)
-- DATE: 2026-01-23
-- DESCRIPTION: Atualiza a RPC de criação de OS para exigir cliente_id.
-- Implementa validação estrita de Tenant vs Cliente.
-- Remove vulnerabilidade de bypass de Admin.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Atualizando a função com a nova assinatura e lógica
CREATE OR REPLACE FUNCTION create_os_with_micro_tasks(
    p_empresa_id UUID,
    p_titulo TEXT,
    p_descricao TEXT,
    p_deadline_at TIMESTAMPTZ,
    p_workflow_stages JSONB,
    p_drive_link TEXT DEFAULT NULL,
    p_created_by UUID DEFAULT auth.uid(),
    p_prioridade TEXT DEFAULT 'normal',
    p_cliente_id UUID DEFAULT NULL -- Novo parâmetro (Defaults NULL para não quebrar assinatura, mas valida dentro)
) RETURNS JSONB AS $$
DECLARE
    v_macro_task tarefas%ROWTYPE;
    v_micro_task tarefas_micro%ROWTYPE;
    v_result JSONB;
    v_stage JSONB;
    v_ordem INTEGER;
    v_micro_tasks JSONB := '[]'::JSONB;
    v_depends_on_id UUID;
    v_user_role TEXT;
    v_normalized_priority TEXT;
    v_cliente_empresa_id UUID;
BEGIN
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- VALIDAÇÕES PRÉ-EXECUÇÃO
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    -- Validação 1: Campos obrigatórios (INCLUINDO CLIENTE_ID AGORA)
    IF p_empresa_id IS NULL OR p_titulo IS NULL OR p_deadline_at IS NULL OR p_created_by IS NULL THEN
        RAISE EXCEPTION 'Campos obrigatórios: empresa_id, titulo, deadline_at, created_by';
    END IF;

    -- [NEW CONTRACT] Validação 1.1: Cliente Obrigatório
    IF p_cliente_id IS NULL THEN
        RAISE EXCEPTION 'A partir de agora, toda nova OS exige um Cliente (Sub-Entidade) vinculado.';
    END IF;

    -- [NEW CONTRACT] Validação 1.2: Cliente pertence ao Tenant?
    SELECT empresa_id INTO v_cliente_empresa_id
    FROM clientes
    WHERE id = p_cliente_id;

    IF v_cliente_empresa_id IS NULL OR v_cliente_empresa_id != p_empresa_id THEN
         RAISE EXCEPTION 'Violação de Isolamento: O Cliente informado não pertence à Empresa (Tenant) da OS.';
    END IF;
    
    -- Validação 2: Workflow stages válido
    IF p_workflow_stages IS NULL OR jsonb_array_length(p_workflow_stages) = 0 THEN
        RAISE EXCEPTION 'workflow_stages deve conter ao menos 1 etapa';
    END IF;
    
    -- Validação 3: Obter role do usuário
    SELECT role INTO v_user_role
    FROM profissionais
    WHERE id = p_created_by;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuário não encontrado: %', p_created_by;
    END IF;
    
    -- Validação 4: Permissão (Admin e Staff precisam de vínculo)
    -- [SECURITY FIX] Removido o bypass cego de admin. Todos passam pela checagem.
    -- Super Admin é a única exceção global.
    IF v_user_role = 'super_admin' THEN
        -- Allow
        NULL;
    ELSE
        PERFORM 1 FROM empresa_profissionais
        WHERE profissional_id = p_created_by
        AND empresa_id = p_empresa_id
        AND ativo = true;
        
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Permissão negada: Você não tem vínculo ativo com o Tenant %.', p_empresa_id;
        END IF;
    END IF;
    
    -- Validação 5: Normalizar prioridade
    v_normalized_priority := CASE 
        WHEN p_prioridade IN ('baixa', 'normal', 'alta', 'urgente') THEN p_prioridade
        ELSE 'normal'
    END;
    
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- TRANSAÇÃO: CRIAR MACRO-TASK + MICRO-TASKS
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    -- Passo 1: Criar macro-task (COM CLIENTE_ID)
    INSERT INTO tarefas (
        titulo,
        descricao,
        empresa_id,
        created_by,
        deadline,
        status,
        prioridade,
        progress,
        drive_link,
        cliente_id -- [NEW]
    ) VALUES (
        p_titulo,
        p_descricao,
        p_empresa_id,
        p_created_by,
        p_deadline_at,
        'pendente',
        v_normalized_priority,
        0,
        p_drive_link,
        p_cliente_id -- [NEW]
    ) RETURNING * INTO v_macro_task;
    
    -- Passo 2: Criar micro-tasks (Mantido igual)
    FOR v_ordem IN 1..jsonb_array_length(p_workflow_stages) LOOP
        v_stage := p_workflow_stages -> (v_ordem - 1);
        
        -- Validar stage...
        IF NOT (v_stage ? 'profissional_id' AND v_stage ? 'funcao') THEN
            RAISE EXCEPTION 'Stage % está faltando profissional_id ou funcao', v_ordem;
        END IF;
        
        -- Determinar depends_on...
        v_depends_on_id := NULL;
        IF v_ordem > 1 THEN
            SELECT id INTO v_depends_on_id
            FROM jsonb_to_recordset(v_micro_tasks) AS x(id UUID, ordem INTEGER)
            WHERE ordem = v_ordem - 1;
        END IF;
        
        -- Criar micro-task (Mantido)
        INSERT INTO tarefas_micro (
            tarefa_id,
            profissional_id,
            funcao,
            peso,
            status,
            depends_on,
            deadline_at
        ) VALUES (
            v_macro_task.id,
            (v_stage->>'profissional_id')::UUID,
            v_stage->>'funcao',
            COALESCE((v_stage->>'peso')::INTEGER, 1),
            CASE WHEN v_ordem = 1 THEN 'pendente' ELSE 'bloqueada' END,
            v_depends_on_id,
            (v_stage->>'deadline_at')::TIMESTAMPTZ
        ) RETURNING * INTO v_micro_task;
        
        -- Array result...
        v_micro_tasks := v_micro_tasks || jsonb_build_object(
            'id', v_micro_task.id,
            'ordem', v_ordem,
            'funcao', v_micro_task.funcao,
            'status', v_micro_task.status,
            'profissional_id', v_micro_task.profissional_id
        );
        
        -- Logs...
        INSERT INTO tarefas_micro_logs (tarefa_micro_id, to_profissional_id, acao) 
        VALUES (v_micro_task.id, v_micro_task.profissional_id, 'created');
        
        -- Notificação...
        IF v_micro_task.status = 'pendente' THEN
            INSERT INTO notifications (profissional_id, title, message, type, link, read) 
            VALUES (v_micro_task.profissional_id, 'Nova Etapa', format('Etapa %s na OS: %s', v_micro_task.funcao, p_titulo), 'micro_task_assigned', '/staff/tasks', false);
        END IF;
    END LOOP;
    
    -- Retorno
    RETURN jsonb_build_object(
        'success', true,
        'mode', 'transactional_rpc_v2', -- Updated Mode
        'macro_task_id', v_macro_task.id,
        'macro_task_titulo', v_macro_task.titulo,
        'created_at_tenant', v_macro_task.empresa_id,
        'linked_client', v_macro_task.cliente_id
    );
    
EXCEPTION 
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Erro ao criar OS (V2): % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
