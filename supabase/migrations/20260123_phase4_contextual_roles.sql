-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: FASE 4 - CONTEXTUAL ROLES & PERMISSIONS
-- DATE: 2026-01-23
-- DESCRIPTION: Implementa funções contextuais por cliente (Sub-Entidade).
-- 1. Cria tabela 'cliente_profissionais' (Vínculo Pro <-> Cliente).
-- 2. Define RLS para essa tabela.
-- 3. Atualiza RPC de criação de OS para validar função por cliente.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Create Link Table
CREATE TABLE IF NOT EXISTS public.cliente_profissionais (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
    profissional_id UUID NOT NULL REFERENCES public.profissionais(id) ON DELETE CASCADE,
    funcao TEXT NOT NULL,
    ativo BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(cliente_id, profissional_id, funcao)
);

-- 2. Enable RLS
ALTER TABLE public.cliente_profissionais ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
-- Super Admin: Full Access
CREATE POLICY "Super Admin: Full Access Link"
    ON public.cliente_profissionais FOR ALL TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- Admin: Manage Links for Own Tenant's Clients
CREATE POLICY "Admin: Manage Client Links"
    ON public.cliente_profissionais FOR ALL TO authenticated
    USING (
        public.is_admin_safe() AND
        EXISTS (
            SELECT 1 FROM clientes c
            WHERE c.id = cliente_profissionais.cliente_id
            AND c.empresa_id IN (
                SELECT empresa_id FROM empresa_profissionais 
                WHERE profissional_id = auth.uid() AND ativo = true
            )
        )
    )
    WITH CHECK (
        public.is_admin_safe() AND
        EXISTS (
            SELECT 1 FROM clientes c
            WHERE c.id = cliente_profissionais.cliente_id
            AND c.empresa_id IN (
                SELECT empresa_id FROM empresa_profissionais 
                WHERE profissional_id = auth.uid() AND ativo = true
            )
        )
    );

-- Staff: View Own Links (To know their functions)
CREATE POLICY "Staff: View Own Links"
    ON public.cliente_profissionais FOR SELECT TO authenticated
    USING (profissional_id = auth.uid() AND ativo = true);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_cliente_profissionais_lookup 
ON public.cliente_profissionais(cliente_id, profissional_id, funcao);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. UPDATE RPC (V4) - Enforce Contextual Validation
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION create_os_with_micro_tasks(
    p_empresa_id UUID,
    p_titulo TEXT,
    p_descricao TEXT,
    p_deadline_at TIMESTAMPTZ,
    p_workflow_stages JSONB,
    p_drive_link TEXT DEFAULT NULL,
    p_created_by UUID DEFAULT auth.uid(),
    p_prioridade TEXT DEFAULT 'normal',
    p_cliente_id UUID DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_macro_task tarefas%ROWTYPE;
    v_micro_task tarefas_micro%ROWTYPE;
    v_stage JSONB;
    v_ordem INTEGER;
    v_micro_tasks JSONB := '[]'::JSONB;
    v_depends_on_id UUID;
    v_user_role TEXT;
    v_normalized_priority TEXT;
    v_cliente_empresa_id UUID;
    v_stage_prof_id UUID;
    v_stage_funcao TEXT;
BEGIN
    -- [SAME CHECKS AS V3] --
    
    SELECT role INTO v_user_role FROM profissionais WHERE id = p_created_by;
    IF NOT FOUND THEN RAISE EXCEPTION 'Usuário solicitante não encontrado.'; END IF;

    IF v_user_role = 'super_admin' THEN
        RAISE EXCEPTION 'Super Admin não pode criar Ordens de Serviço. Use uma conta de Admin ou Staff.';
    END IF;

    IF p_empresa_id IS NULL OR p_titulo IS NULL OR p_deadline_at IS NULL OR p_created_by IS NULL THEN
        RAISE EXCEPTION 'Campos obrigatórios: empresa_id, titulo, deadline_at, created_by';
    END IF;

    IF p_cliente_id IS NULL THEN
        RAISE EXCEPTION 'A partir de agora, toda nova OS exige um Cliente (Sub-Entidade) vinculado.';
    END IF;

    SELECT empresa_id INTO v_cliente_empresa_id FROM clientes WHERE id = p_cliente_id;
    IF v_cliente_empresa_id IS NULL OR v_cliente_empresa_id != p_empresa_id THEN
         RAISE EXCEPTION 'Violação de Isolamento: O Cliente informado não pertence à Empresa (Tenant) da OS.';
    END IF;
    
    IF p_workflow_stages IS NULL OR jsonb_array_length(p_workflow_stages) = 0 THEN
        RAISE EXCEPTION 'workflow_stages deve conter ao menos 1 etapa';
    END IF;

    IF v_user_role = 'staff' AND jsonb_array_length(p_workflow_stages) > 1 THEN
        RAISE EXCEPTION 'Staff só tem permissão para criar OS Simples (1 etapa). Para workflows complexos, solicite a um Admin.';
    END IF;
    
    PERFORM 1 FROM empresa_profissionais
    WHERE profissional_id = p_created_by AND empresa_id = p_empresa_id AND ativo = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Permissão negada: Você não tem vínculo ativo com o Tenant %.', p_empresa_id; END IF;

    v_normalized_priority := CASE 
        WHEN p_prioridade IN ('baixa', 'normal', 'alta', 'urgente') THEN p_prioridade
        ELSE 'normal'
    END;
    
    -- INSERT MACRO TASK
    INSERT INTO tarefas (
        titulo, descricao, empresa_id, created_by, deadline, 
        status, prioridade, progress, drive_link, cliente_id
    ) VALUES (
        p_titulo, p_descricao, p_empresa_id, p_created_by, p_deadline_at,
        'pendente', v_normalized_priority, 0, p_drive_link, p_cliente_id
    ) RETURNING * INTO v_macro_task;
    
    -- INSERT MICRO TASKS
    FOR v_ordem IN 1..jsonb_array_length(p_workflow_stages) LOOP
        v_stage := p_workflow_stages -> (v_ordem - 1);
        v_stage_prof_id := (v_stage->>'profissional_id')::UUID;
        v_stage_funcao := v_stage->>'funcao'; -- Extrair função
        
        IF NOT (v_stage ? 'profissional_id' AND v_stage ? 'funcao') THEN
            RAISE EXCEPTION 'Stage % está faltando profissional_id ou funcao', v_ordem;
        END IF;

        -- [NEW VALIDATION V4] Contextual Role Check
        -- Verifica se o profissional tem essa FUNÇÃO específica neste CLIENTE
        PERFORM 1 FROM cliente_profissionais
        WHERE profissional_id = v_stage_prof_id
        AND cliente_id = p_cliente_id
        AND funcao = v_stage_funcao
        AND ativo = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Violação de Função: O profissional não possui a função "%" habilitada para este Cliente.', v_stage_funcao;
        END IF;
        
        -- Dependências e Insert (Mantido)
        v_depends_on_id := NULL;
        IF v_ordem > 1 THEN
            SELECT id INTO v_depends_on_id
            FROM jsonb_to_recordset(v_micro_tasks) AS x(id UUID, ordem INTEGER)
            WHERE ordem = v_ordem - 1;
        END IF;
        
        INSERT INTO tarefas_micro (
            tarefa_id, profissional_id, funcao, peso, 
            status, depends_on, deadline_at
        ) VALUES (
            v_macro_task.id, v_stage_prof_id, v_stage_funcao, 
            COALESCE((v_stage->>'peso')::INTEGER, 1),
            CASE WHEN v_ordem = 1 THEN 'pendente' ELSE 'bloqueada' END,
            v_depends_on_id, (v_stage->>'deadline_at')::TIMESTAMPTZ
        ) RETURNING * INTO v_micro_task;
        
        v_micro_tasks := v_micro_tasks || jsonb_build_object(
            'id', v_micro_task.id, 'ordem', v_ordem, 'funcao', v_micro_task.funcao,
            'status', v_micro_task.status, 'profissional_id', v_micro_task.profissional_id
        );
        
        INSERT INTO tarefas_micro_logs (tarefa_micro_id, to_profissional_id, acao) 
        VALUES (v_micro_task.id, v_stage_prof_id, 'created');
        
        IF v_micro_task.status = 'pendente' THEN
            INSERT INTO notifications (profissional_id, title, message, type, link, read) 
            VALUES (v_stage_prof_id, 'Nova Etapa', format('Etapa %s na OS: %s', v_micro_task.funcao, p_titulo), 'micro_task_assigned', '/staff/tasks', false);
        END IF;
    END LOOP;
    
    RETURN jsonb_build_object(
        'success', true,
        'mode', 'transactional_rpc_v4_contextual',
        'macro_task_id', v_macro_task.id,
        'micro_tasks_created', jsonb_array_length(v_micro_tasks)
    );
    
EXCEPTION 
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Erro ao criar OS (V4): % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
