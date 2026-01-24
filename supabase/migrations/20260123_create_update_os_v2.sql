-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: CREATE update_os_v2 (Safe & Hardened)
-- DATE: 2026-01-23
-- DESCRIPTION: Implements the definitive version of OS Update (v2).
-- Replaces usage of update_os.
-- Uses 'can_update_os' for permission validation.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION update_os_v2(
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
    v_current_micro_count INT;
    v_can_update BOOLEAN;
BEGIN
    -- 1. Validate Permissions using Canonical Helper
    -- This relies on the implementation of 'can_update_os' which checks RBAC + Tenant + Creator rules
    -- If can_update_os is not found, we fallback to a safe exception, but the user confirmed it exists.
    
    -- We can call the function directly if it returns boolean
    v_can_update := can_update_os(p_os_id);

    IF NOT v_can_update THEN
        RAISE EXCEPTION 'Permission denied: detection logic rejected update request.';
    END IF;

    -- 2. Fetch OS (Double check existence, though can_update_os likely checked it)
    SELECT * INTO v_tarefa FROM tarefas WHERE id = p_os_id;

    IF v_tarefa.id IS NULL THEN
        RAISE EXCEPTION 'OS not found';
    END IF;

    IF v_tarefa.status IN ('identificando', 'cancelada') THEN -- Safety check on status
        RAISE EXCEPTION 'Cannot edit OS in current status';
    END IF;

    -- 3. Update Basic Fields
    -- Only update if provided in payload and non-null
    UPDATE tarefas
    SET 
        titulo = COALESCE(p_payload->>'titulo', titulo),
        descricao = COALESCE(p_payload->>'descricao', descricao),
        deadline = COALESCE((p_payload->>'deadline')::TIMESTAMPTZ, deadline),
        drive_link = COALESCE(p_payload->>'drive_link', drive_link),
        updated_at = NOW()
    WHERE id = p_os_id;

    -- 4. Handle Micro Tasks (Workflow Only)
    
    -- Count existing active micro tasks
    SELECT COUNT(*) INTO v_current_micro_count FROM tarefas_micro WHERE tarefa_id = p_os_id AND ativo = true;

    IF p_payload ? 'micro_tasks' THEN
        -- CRITICA: Se for OS Simples (0 micro tasks) e tentar adicionar -> BLOQUEAR
        IF v_current_micro_count = 0 AND jsonb_array_length(p_payload->'micro_tasks') > 0 THEN
             RAISE EXCEPTION 'Cannot add micro-tasks to a Simple OS (Staff flow).';
        END IF;

        -- Iterate and Insert implicit "New" ones if structure matches (Compatibility)
        FOR v_micro_task IN SELECT * FROM jsonb_array_elements(p_payload->'micro_tasks')
        LOOP
            IF (v_micro_task->>'id') IS NULL THEN
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
            END IF;
        END LOOP;
        
        -- Handling "add_micro_tasks" specifically (Preferred)
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
                    v_mt_id UUID := (v_micro_task::text)::UUID;
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

    -- 5. Handle Attachments (Soft Delete only)
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
    VALUES (p_os_id, auth.uid(), 'update_os_v2', p_payload);

END;
$$;

-- Grant permissions explicitly
GRANT EXECUTE ON FUNCTION update_os_v2(UUID, JSONB) TO authenticated, service_role;
