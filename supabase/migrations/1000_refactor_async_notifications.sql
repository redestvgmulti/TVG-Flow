-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Migration 1000: Refactor Async Notifications (Queue-Based)
-- Date: 2026-01-23
-- Description: Transition legacy sync triggers (os_eventos) to the Async Queue.
--              1. Updates notification_queue constraints to support new types.
--              2. Updates processor to handle 'status_alterado' and 'target_ids'.
--              3. Rewrites trigger to insert into queue instead of direct table.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BEGIN;

-- 1. UPDATE QUEUE CONSTRAINTS
--    Drop existing check constraint and add new one with broader types
ALTER TABLE notification_queue DROP CONSTRAINT IF EXISTS notification_queue_event_type_check;

ALTER TABLE notification_queue ADD CONSTRAINT notification_queue_event_type_check 
CHECK (event_type IN (
    'macro_completed',
    'micro_completed', 
    'micro_returned',
    'task_assigned',
    'status_alterado',       -- NEW
    'comentario_adicionado', -- NEW
    'profissional_atribuido' -- NEW
));

-- 2. UPDATE PROCESSOR TO HANDLE TARGETED NOTIFICATIONS
CREATE OR REPLACE FUNCTION process_notification_queue()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_size INT := 100;
    v_queue_record RECORD;
    v_target_ids UUID[];
    v_admin_ids UUID[];
    v_final_targets UUID[];
BEGIN
    -- Cache admins for default behavior
    SELECT ARRAY_AGG(id) INTO v_admin_ids
    FROM profissionais
    WHERE role IN ('admin', 'manager', 'master')
      AND ativo = true;

    -- Process pending queue items
    FOR v_queue_record IN
        SELECT *
        FROM notification_queue
        WHERE status = 'pending'
          AND entity_id IS NOT NULL
        ORDER BY created_at
        LIMIT v_batch_size
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            UPDATE notification_queue
            SET status = 'processing',
                retry_count = retry_count + 1
            WHERE id = v_queue_record.id;

            -- DETERMINE TARGETS (Specific targets > Admins)
            -- Check if payload has 'target_ids'
            IF v_queue_record.payload ? 'target_ids' AND jsonb_array_length(v_queue_record.payload->'target_ids') > 0 THEN
                SELECT ARRAY_AGG(value::uuid) INTO v_target_ids
                FROM jsonb_array_elements_text(v_queue_record.payload->'target_ids');
                v_final_targets := v_target_ids;
            ELSE
                -- Default to admins for macro/micro completion (legacy behavior)
                v_final_targets := v_admin_ids;
            END IF;

            IF v_final_targets IS NULL THEN
                 -- Fallback if no targets found
                 v_final_targets := v_admin_ids;
            END IF;

            -- INSERT NOTIFICATIONS FOR EACH TARGET
            -- 1. MACRO/MICRO COMPLETED (Legacy Types)
            IF v_queue_record.event_type IN ('macro_completed', 'micro_completed', 'micro_returned') THEN
                INSERT INTO notifications (
                    profissional_id, type, title, message, link, entity_id, entity_type, metadata, read_at
                )
                SELECT
                    target_id,
                    CASE v_queue_record.event_type
                        WHEN 'macro_completed' THEN 'macro_task_completed'
                        WHEN 'micro_completed' THEN 'micro_task_completed'
                        WHEN 'micro_returned' THEN 'micro_task_returned'
                    END,
                    v_queue_record.payload->>'title',
                    v_queue_record.payload->>'message',
                    v_queue_record.payload->>'link',
                    v_queue_record.entity_id,
                    v_queue_record.entity_type,
                    jsonb_build_object(
                        'created_via', 'queue_processor',
                        'original_event', v_queue_record.event_type,
                        'payload', v_queue_record.payload
                    ),
                    NULL
                FROM UNNEST(v_final_targets) AS target_id
                ON CONFLICT DO NOTHING; -- Simple dedupe

            -- 2. STATUS / COMMENTS / ASSIGNMENT (New Types)
            ELSIF v_queue_record.event_type IN ('status_alterado', 'comentario_adicionado', 'profissional_atribuido') THEN
                INSERT INTO notifications (
                    profissional_id, type, title, message, link, entity_id, entity_type, metadata, read_at
                )
                SELECT
                    target_id,
                    CASE v_queue_record.event_type
                         WHEN 'status_alterado' THEN 'task_status_updated'
                         WHEN 'comentario_adicionado' THEN 'comment_added'
                         WHEN 'profissional_atribuido' THEN 'task_assigned'
                    END,
                    v_queue_record.payload->>'title',
                    v_queue_record.payload->>'message',
                    coalesce(v_queue_record.payload->>'link', '/admin/tasks'),
                    v_queue_record.entity_id,
                    v_queue_record.entity_type,
                    v_queue_record.payload, -- Use full payload as metadata for context
                    NULL
                FROM UNNEST(v_final_targets) AS target_id
                ON CONFLICT DO NOTHING;
            END IF;

            -- Mark as completed
            UPDATE notification_queue
            SET status = 'completed',
                processed_at = NOW(),
                error = NULL
            WHERE id = v_queue_record.id;

        EXCEPTION WHEN OTHERS THEN
            UPDATE notification_queue
            SET status = 'failed',
                error = SQLERRM,
                processed_at = NOW()
            WHERE id = v_queue_record.id;
        END;
    END LOOP;
END;
$$;


-- 3. REWRITE TRIGGER TO USE QUEUE
CREATE OR REPLACE FUNCTION criar_notificacoes_evento()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task_title TEXT;
    v_client_name TEXT;
    v_targets UUID[];
    v_payload JSONB;
    v_old_status TEXT;
    v_new_status TEXT;
    v_title TEXT;
    v_message TEXT;
BEGIN
    -- 1. Determine importance
    IF NEW.tipo NOT IN ('comentario_adicionado', 'status_alterado', 'profissional_atribuido') THEN
        RETURN NEW;
    END IF;

    -- 2. Fetch Aggregated Targets (Creator + Assigned + Micro-task Owners)
    --    Exclude self (autor_id)
    SELECT ARRAY_AGG(DISTINCT p.id)
    INTO v_targets
    FROM profissionais p
    INNER JOIN tarefas t ON t.id = NEW.os_id
    WHERE (
        t.created_by = p.id
        OR t.assigned_to = p.id
        OR EXISTS (SELECT 1 FROM tarefas_micro tm WHERE tm.tarefa_id = t.id AND tm.profissional_id = p.id)
    )
    AND p.id != COALESCE(NEW.autor_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND p.ativo = true;

    IF v_targets IS NULL OR array_length(v_targets, 1) IS NULL THEN
        RETURN NEW; -- No one to notify
    END IF;

    -- 3. Fetch Context
    SELECT t.titulo, c.nome
    INTO v_task_title, v_client_name
    FROM tarefas t
    LEFT JOIN clientes c ON c.id = t.cliente_id
    WHERE t.id = NEW.os_id;

    v_task_title := COALESCE(v_task_title, 'Tarefa');
    v_client_name := COALESCE(v_client_name, 'Interno');

    -- 4. Construct Payload Message
    CASE NEW.tipo
        WHEN 'status_alterado' THEN
            v_old_status := COALESCE(NEW.metadata->>'de', '?');
            v_new_status := COALESCE(NEW.metadata->>'para', '?');
            v_title := 'Status atualizado';
            v_message := format('A tarefa "%s" (%s) mudou de "%s" para "%s".', v_task_title, v_client_name, v_old_status, v_new_status);
        
        WHEN 'comentario_adicionado' THEN
            v_title := 'Novo comentário';
            v_message := format('Em "%s": %s', v_task_title, NEW.metadata->>'preview');

        WHEN 'profissional_atribuido' THEN
            v_title := 'Você foi atribuído';
            v_message := format('Você foi atribuído à tarefa "%s" (%s).', v_task_title, v_client_name);
            
        ELSE
            v_title := 'Atualização';
            v_message := v_task_title;
    END CASE;

    -- 5. Insert into Queue
    INSERT INTO notification_queue (
        event_type,
        entity_id,
        entity_type,
        payload
    ) VALUES (
        NEW.tipo::text, -- Cast enum to text
        NEW.os_id,
        'task',
        jsonb_build_object(
            'title', v_title,
            'message', v_message,
            'link', '/admin/tasks',
            'target_ids', v_targets,
            'metadata', NEW.metadata,
            'source_event_id', NEW.id
        )
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
