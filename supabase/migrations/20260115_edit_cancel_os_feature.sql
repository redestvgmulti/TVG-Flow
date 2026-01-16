-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: OS Edit & Cancel Feature (Production Safe)
-- DATE: 2026-01-15
-- DESCRIPTION: Implements "soft" cancellation, editing capabilities for creators,
-- and soft-delete for micro-tasks/attachments.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. SCHEMA UPDATES (Forward-Only)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Safely update Status Constraint to include 'cancelada'
DO $$
BEGIN
    -- Only attempt if the constraint exists or we need to ensure it covers 'cancelada'
    ALTER TABLE tarefas DROP CONSTRAINT IF EXISTS tarefas_status_check;
    
    ALTER TABLE tarefas 
    ADD CONSTRAINT tarefas_status_check 
    CHECK (status IN ('pendente', 'em_execucao', 'concluida', 'atrasada', 'cancelada'));
END $$;

-- Add Soft Delete support for Micro Tasks
ALTER TABLE tarefas_micro 
ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;

-- Add Soft Delete support for Attachments
ALTER TABLE task_attachments 
ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS removed_by UUID REFERENCES profissionais(id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. RPC: CANCEL OS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION cancel_os(os_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with elevated privileges to bypass strict RLS if needed, but we check logic manually
SET search_path = public
AS $$
DECLARE
    v_created_by UUID;
    v_status TEXT;
BEGIN
    -- 1. Validate permissions
    SELECT created_by, status INTO v_created_by, v_status
    FROM tarefas
    WHERE id = os_id;

    IF v_created_by IS NULL THEN
        RAISE EXCEPTION 'OS not found';
    END IF;

    IF v_created_by != auth.uid() THEN
        RAISE EXCEPTION 'Permission denied: Only the creator can cancel this OS';
    END IF;

    IF v_status = 'cancelada' THEN
        RAISE EXCEPTION 'OS is already cancelled';
    END IF;

    IF v_status = 'concluida' THEN
        RAISE EXCEPTION 'Cannot cancel a completed OS';
    END IF;

    -- 2. Execute Soft Cancel
    UPDATE tarefas
    SET status = 'cancelada',
        updated_at = NOW()
    WHERE id = os_id;

    -- 3. Audit Log (using existing mechanism or verify if we need to insert manually)
    -- Assuming `logs_tarefas` triggers handle basic updates, but we'll add a specific log entry if needed.
    -- The existing generic trigger should catch the status change.
    
    INSERT INTO logs_tarefas (tarefa_id, usuario_id, acao, dados_anteriores, dados_novos)
    VALUES (os_id, auth.uid(), 'cancel_os', jsonb_build_object('status', v_status), jsonb_build_object('status', 'cancelada'));

END;
$$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. RPC: UPDATE OS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION update_os(
    p_os_id UUID,
    p_payload JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tarefa RECORD;
    v_micro_task JSONB;
    v_attachment_id UUID;
    v_new_micro_count INT := 0;
    v_current_micro_count INT;
BEGIN
    -- 1. Fetch OS and Verify Permissions
    SELECT * INTO v_tarefa FROM tarefas WHERE id = p_os_id;

    IF v_tarefa.id IS NULL THEN
        RAISE EXCEPTION 'OS not found';
    END IF;

    IF v_tarefa.created_by != auth.uid() THEN
        RAISE EXCEPTION 'Permission denied: Only the creator can edit this OS';
    END IF;

    IF v_tarefa.status IN ('identificando', 'cancelada') THEN -- Safety check on status
        RAISE EXCEPTION 'Cannot edit OS in current status';
    END IF;

    -- 2. Update Basic Fields
    -- Only update if provided in payload and non-null
    UPDATE tarefas
    SET 
        titulo = COALESCE(p_payload->>'titulo', titulo),
        descricao = COALESCE(p_payload->>'descricao', descricao),
        deadline = COALESCE((p_payload->>'deadline')::TIMESTAMPTZ, deadline),
        drive_link = COALESCE(p_payload->>'drive_link', drive_link),
        updated_at = NOW()
    WHERE id = p_os_id;

    -- 3. Handle Micro Tasks (Workflow Only)
    
    -- Count existing micro tasks to determine if it's a workflow
    SELECT COUNT(*) INTO v_current_micro_count FROM tarefas_micro WHERE tarefa_id = p_os_id AND ativo = true;

    IF p_payload ? 'micro_tasks' THEN
        -- CRITICA: Se for OS Simples (0 micro tasks) e tentar adicionar -> BLOQUEAR
        -- A menos que a payload venha vazia, mas se vier com items...
        IF v_current_micro_count = 0 AND jsonb_array_length(p_payload->'micro_tasks') > 0 THEN
             -- Check if we really are adding new ones or just sending empty list
             -- Actually, simpler rule: If current count is 0, we treat it as Simple OS.
             -- But wait, maybe they want to Convert Simple -> Workflow?
             -- User prompt says: "❌ NÃO podem virar workflow". So we MUST BLOCK.
             RAISE EXCEPTION 'Cannot add micro-tasks to a Simple OS (Staff flow).';
        END IF;

        -- Iterate over provided micro tasks
        FOR v_micro_task IN SELECT * FROM jsonb_array_elements(p_payload->'micro_tasks')
        LOOP
            IF (v_micro_task->>'id') IS NULL THEN
                -- INSERT NEW (Only allowed if Workflow/Admin flow was original)
                -- Double check logic: we established v_current_micro_count > 0 implies Workflow.
                -- Use a flag or check existing count again? 
                -- Actually, if we passed the check above, and v_current_micro_count > 0, we are safe.
                -- But if v_current_micro_count was 0 and we are here, we raised exception. 
                -- Wait, what if it WAS a workflow but all tasks were removed? Unlikely given logic.
                -- We assume "Staff OS" implies creation flow didn't add tasks.
                
                INSERT INTO tarefas_micro (
                    tarefa_id,
                    profissional_id,
                    funcao,
                    peso,
                    status
                ) VALUES (
                    p_os_id,
                    (v_micro_task->>'profissional_id')::UUID,
                    v_micro_task->>'funcao',
                    COALESCE((v_micro_task->>'peso')::INT, 1),
                    'pendente'
                );
            ELSE
                -- CHECK FOR REMOVAL (Soft Delete)
                -- Frontend sends explicit "deleted: true" or we infer from absence?
                -- Payload design: Let's assume payload contains actions or list of "to be kept"?
                -- Better: Payload contains "changes". 
                -- Let's assume the payload 'micro_tasks' is a list of tasks to UPSERT/SYNC.
                -- Actually, implementing "Sync" logic is hard in SQL. 
                -- Simpler Approach: Payload has `added_micro_tasks` and `removed_micro_task_ids`.
                -- But standard practice is usually a list. 
                -- Let's stick to: The payload contains a list of operations or users handle specific actions.
                -- User prompt: "Criador pode Adicionar ... Remover".
                -- Let's support specific keys in payload: `add_micro_tasks` (array) and `remove_micro_task_ids` (array of UUIDs).
                NULL; -- See specific block below
            END IF;
        END LOOP;
        
        -- Handling "add_micro_tasks" specifically to be cleaner
        IF p_payload ? 'add_micro_tasks' THEN
             IF v_current_micro_count = 0 THEN
                 RAISE EXCEPTION 'Cannot add micro-tasks to a Simple OS.';
             END IF;
             
             FOR v_micro_task IN SELECT * FROM jsonb_array_elements(p_payload->'add_micro_tasks')
             LOOP
                INSERT INTO tarefas_micro (
                    tarefa_id,
                    profissional_id,
                    funcao,
                    peso,
                    status
                ) VALUES (
                    p_os_id,
                    (v_micro_task->>'profissional_id')::UUID,
                    v_micro_task->>'funcao',
                    COALESCE((v_micro_task->>'peso')::INT, 1),
                    'pendente'
                );
             END LOOP;
        END IF;

        -- Handling "remove_micro_task_ids"
        IF p_payload ? 'remove_micro_task_ids' THEN
            FOR v_micro_task IN SELECT * FROM jsonb_array_elements(p_payload->'remove_micro_task_ids')
            LOOP
                -- Validate Status
                DECLARE
                    v_mt_status TEXT;
                    v_mt_id UUID := (v_micro_task::text)::UUID; -- extracting UUID from jsonb string
                BEGIN
                    SELECT status INTO v_mt_status FROM tarefas_micro WHERE id = v_mt_id AND tarefa_id = p_os_id;
                    
                    IF v_mt_status IN ('em_execucao', 'concluida') THEN
                        RAISE EXCEPTION 'Cannot remove micro-task % because it is %', v_mt_id, v_mt_status;
                    END IF;
                    
                    -- Soft Delete
                    UPDATE tarefas_micro SET ativo = false WHERE id = v_mt_id;
                END;
            END LOOP;
        END IF;

    END IF;

    -- 4. Handle Attachments (Soft Delete only)
    IF p_payload ? 'remove_attachment_ids' THEN
        FOR v_attachment_id IN SELECT * FROM jsonb_array_elements_text(p_payload->'remove_attachment_ids')
        LOOP
            UPDATE task_attachments 
            SET removed_at = NOW(),
                removed_by = auth.uid()
            WHERE id = v_attachment_id AND tarefa_id = p_os_id;
        END LOOP;
    END IF;
    
    -- Log update
    INSERT INTO logs_tarefas (tarefa_id, usuario_id, acao, dados_novos)
    VALUES (p_os_id, auth.uid(), 'update_os', p_payload);

END;
$$;
