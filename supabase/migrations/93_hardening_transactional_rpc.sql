-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- HARDENING 002: Transactional OS Creation RPC
-- Migration: 042_hardening_transactional_rpc.sql
-- Priority: HIGH
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PROBLEMA:
-- Edge Function create-os-by-function não é transacional. Falhas parciais
-- criam tarefas macro órfãs sem micro-tasks vinculadas.
--
-- SOLUÇÃO:
-- RPC transacional ACID-compliant que garante rollback automático em falhas.
-- Edge Function continua disponível para backward compatibility.
--
-- IMPACTO:
-- Zero breaking changes. RPC é opção adicional, não substitui Edge Function.
-- Frontend pode migrar gradualmente para usar RPC ao invés de Edge Function.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. CREATE TRANSACTIONAL RPC FUNCTION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION create_os_with_micro_tasks(
    p_empresa_id UUID,
    p_titulo TEXT,
    p_descricao TEXT,
    p_deadline_at TIMESTAMPTZ,
    p_workflow_stages JSONB,
    p_drive_link TEXT DEFAULT NULL,
    p_created_by UUID DEFAULT auth.uid(),
    p_prioridade TEXT DEFAULT 'normal'
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
BEGIN
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- VALIDAÇÕES PRÉ-EXECUÇÃO
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    -- Validação 1: Campos obrigatórios
    IF p_empresa_id IS NULL OR p_titulo IS NULL OR p_deadline_at IS NULL OR p_created_by IS NULL THEN
        RAISE EXCEPTION 'Campos obrigatórios: empresa_id, titulo, deadline_at, created_by';
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
    
    -- Validação 4: Permissão (admin bypassa, staff precisa vínculo)
    IF v_user_role != 'admin' THEN
        PERFORM 1 FROM empresa_profissionais
        WHERE profissional_id = p_created_by
        AND empresa_id = p_empresa_id
        AND ativo = true;
        
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Você não tem permissão para criar tarefas nesta empresa';
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
    
    -- Passo 1: Criar macro-task
    INSERT INTO tarefas (
        titulo,
        descricao,
        empresa_id,
        created_by,
        deadline,
        status,
        prioridade,
        progress,
        drive_link
    ) VALUES (
        p_titulo,
        p_descricao,
        p_empresa_id,
        p_created_by,
        p_deadline_at,
        'pendente',
        v_normalized_priority,
        0,
        p_drive_link
    ) RETURNING * INTO v_macro_task;
    
    -- Passo 2: Criar micro-tasks com dependências
    FOR v_ordem IN 1..jsonb_array_length(p_workflow_stages) LOOP
        v_stage := p_workflow_stages -> (v_ordem - 1);
        
        -- Validar stage possui campos obrigatórios
        IF NOT (v_stage ? 'profissional_id' AND v_stage ? 'funcao') THEN
            RAISE EXCEPTION 'Stage % está faltando profissional_id ou funcao', v_ordem;
        END IF;
        
        -- Determinar depends_on baseado em ordem
        v_depends_on_id := NULL;
        IF v_ordem > 1 THEN
            -- Depende da micro-task anterior
            SELECT id INTO v_depends_on_id
            FROM jsonb_to_recordset(v_micro_tasks) AS x(id UUID, ordem INTEGER)
            WHERE ordem = v_ordem - 1;
        END IF;
        
        -- Criar micro-task
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
        
        -- Adicionar ao array de resultado
        v_micro_tasks := v_micro_tasks || jsonb_build_object(
            'id', v_micro_task.id,
            'ordem', v_ordem,
            'funcao', v_micro_task.funcao,
            'status', v_micro_task.status,
            'profissional_id', v_micro_task.profissional_id
        );
        
        -- Log de criação
        INSERT INTO tarefas_micro_logs (
            tarefa_micro_id,
            to_profissional_id,
            acao
        ) VALUES (
            v_micro_task.id,
            v_micro_task.profissional_id,
            'created'
        );
        
        -- Notificação (apenas para primeiro pendente)
        IF v_micro_task.status = 'pendente' THEN
            INSERT INTO notifications (
                profissional_id,
                title,
                message,
                type,
                link,
                read
            ) VALUES (
                v_micro_task.profissional_id,
                'Nova Etapa Atribuída',
                format('Você recebeu uma nova etapa de %s: "%s"', v_micro_task.funcao, p_titulo),
                'micro_task_assigned',
                '/staff/tasks',
                false
            );
        END IF;
    END LOOP;
    
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    -- RETORNAR RESULTADO
    -- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    RETURN jsonb_build_object(
        'success', true,
        'mode', 'transactional_rpc',
        'macro_task_id', v_macro_task.id,
        'macro_task_titulo', v_macro_task.titulo,
        'micro_tasks_created', jsonb_array_length(v_micro_tasks),
        'micro_tasks', v_micro_tasks
    );
    
EXCEPTION 
    WHEN OTHERS THEN
        -- Rollback automático por PostgreSQL
        RAISE EXCEPTION 'Erro ao criar OS: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. GRANT PERMISSIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GRANT EXECUTE ON FUNCTION create_os_with_micro_tasks TO authenticated;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. COMMENTS & DOCUMENTATION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON FUNCTION create_os_with_micro_tasks IS 
'Hardening: RPC transacional para criação de OS com micro-tasks. 
Garante atomicidade ACID - rollback automático em falhas.
Alternativa segura à Edge Function não-transacional.

Exemplo de uso:
SELECT create_os_with_micro_tasks(
    p_empresa_id := ''uuid-da-empresa'',
    p_titulo := ''Campanha Natal 2026'',
    p_descricao := ''Criação de materiais'',
    p_deadline_at := NOW() + INTERVAL ''7 days'',
    p_workflow_stages := ''[
        {"profissional_id": "uuid1", "funcao": "design", "deadline_at": "2026-01-20T12:00:00Z"},
        {"profissional_id": "uuid2", "funcao": "copy", "deadline_at": "2026-01-21T12:00:00Z"}
    ]''::JSONB,
    p_prioridade := ''alta''
);';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. ROLLBACK INSTRUCTIONS (if needed)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
--
-- DROP FUNCTION IF EXISTS create_os_with_micro_tasks;
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
