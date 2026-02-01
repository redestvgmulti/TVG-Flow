-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FlowOS Phase 3 — Async Notifications: Replace Sync Triggers with Queue
-- Migration 050: Replace sync triggers with queue inserts (async)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- CRITICAL: Old sync triggers MUST be disabled (migration 048) before this runs
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Validation: Check if sync triggers are disabled
DO $$
DECLARE
    v_enabled_count INT;
BEGIN
    SELECT COUNT(*) INTO v_enabled_count
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON t.tgrelid = c.oid
    JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
    WHERE tgname IN (
        'trg_notify_macro_completion',
        'trg_notify_micro_completion_admin',
        'trg_notify_micro_devolution_admin'
    )
    AND nspname = 'public'
    AND tgenabled != 'D';  -- NOT disabled
    
    IF v_enabled_count > 0 THEN
        RAISE EXCEPTION '❌ ABORT: % sync triggers still ENABLED. Run migration 048 first!', v_enabled_count;
    ELSE
        RAISE NOTICE '✅ Pre-check passed: All sync triggers disabled';
    END IF;
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. Macro Task Completion → Queue
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION queue_macro_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'concluida' AND (OLD IS NULL OR OLD.status != 'concluida') THEN
        -- Insert into queue (async processing)
        INSERT INTO notification_queue (event_type, entity_type, entity_id, payload)
        VALUES (
            'macro_completed',
            'task',
            NEW.id,
            jsonb_build_object(
                'title', 'Tarefa Concluída',
                'message', 'A tarefa macro "' || NEW.titulo || '" foi concluída.',
                'link', '/admin/tasks'
            )
        )
        ON CONFLICT (entity_id, event_type) 
        WHERE status IN ('pending', 'processing') AND created_at > NOW() - INTERVAL '1 hour'
        DO NOTHING;  -- Idempotency: Don't queue duplicate events
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_macro_completion ON tarefas;
CREATE TRIGGER trg_queue_macro_completion
    AFTER UPDATE ON tarefas
    FOR EACH ROW
    EXECUTE FUNCTION queue_macro_completion();

COMMENT ON FUNCTION queue_macro_completion IS 'Async trigger: Queue macro task completion notification instead of sync INSERT';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. Micro Task Completion → Queue
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION queue_micro_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task_title TEXT;
    v_prof_name TEXT;
BEGIN
    IF NEW.status = 'concluida' AND (OLD IS NULL OR OLD.status != 'concluida') THEN
        -- Get related data (still 2 SELECTs, but NO fan-out INSERTs)
        -- This is acceptable: 2 indexed lookups << N admin inserts
        SELECT t.titulo, p.nome 
        INTO v_task_title, v_prof_name
        FROM tarefas t, profissionais p
        WHERE t.id = NEW.tarefa_id AND p.id = NEW.profissional_id;

        -- Insert into queue
        INSERT INTO notification_queue (event_type, entity_type, entity_id, payload)
        VALUES (
            'micro_completed',
            'micro_task',
            NEW.id,
            jsonb_build_object(
                'title', 'Etapa Concluída',
                'message', 'A etapa "' || NEW.funcao || '" foi concluída por ' || COALESCE(v_prof_name, 'desconhecido') || ' na tarefa "' || COALESCE(v_task_title, 'sem título') || '".',
                'link', '/admin/tasks'
            )
        )
        ON CONFLICT (entity_id, event_type) 
        WHERE status IN ('pending', 'processing') AND created_at > NOW() - INTERVAL '1 hour'
        DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_micro_completion ON tarefas_micro;
CREATE TRIGGER trg_queue_micro_completion
    AFTER UPDATE ON tarefas_micro
    FOR EACH ROW
    EXECUTE FUNCTION queue_micro_completion();

COMMENT ON FUNCTION queue_micro_completion IS 'Async trigger: Queue micro task completion notification instead of sync INSERT';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. Micro Task Devolution → Queue
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION queue_micro_devolution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task_title TEXT;
    v_reason TEXT;
BEGIN
    IF NEW.status = 'devolvida' AND (OLD IS NULL OR OLD.status != 'devolvida') THEN
        -- Get task title
        SELECT titulo INTO v_task_title 
        FROM tarefas 
        WHERE id = NEW.tarefa_id;
        
        -- Get reason from logs (most recent)
        SELECT motivo INTO v_reason 
        FROM tarefas_micro_logs 
        WHERE tarefa_micro_id = NEW.id AND acao = 'returned' 
        ORDER BY created_at DESC 
        LIMIT 1;

        -- Insert into queue
        INSERT INTO notification_queue (event_type, entity_type, entity_id, payload)
        VALUES (
            'micro_returned',
            'micro_task',
            NEW.id,
            jsonb_build_object(
                'title', 'Etapa Devolvida',
                'message', 'A etapa "' || NEW.funcao || '" foi devolvida na tarefa "' || COALESCE(v_task_title, 'sem título') || '". Motivo: ' || COALESCE(v_reason, 'Não informado'),
                'link', '/admin/tasks'
            )
        )
        ON CONFLICT (entity_id, event_type) 
        WHERE status IN ('pending', 'processing') AND created_at > NOW() - INTERVAL '1 hour'
        DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_micro_devolution ON tarefas_micro;
CREATE TRIGGER trg_queue_micro_devolution
    AFTER UPDATE ON tarefas_micro
    FOR EACH ROW
    EXECUTE FUNCTION queue_micro_devolution();

COMMENT ON FUNCTION queue_micro_devolution IS 'Async trigger: Queue micro task devolution notification instead of sync INSERT';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Validation: Confirm new queue triggers are active
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
DECLARE
    v_queue_trigger_count INT;
BEGIN
    SELECT COUNT(*) INTO v_queue_trigger_count
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON t.tgrelid = c.oid
    JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
    WHERE tgname IN (
        'trg_queue_macro_completion',
        'trg_queue_micro_completion',
        'trg_queue_micro_devolution'
    )
    AND nspname = 'public'
    AND tgenabled = 'O';  -- 'O' = enabled
    
    IF v_queue_trigger_count != 3 THEN
        RAISE WARNING 'Expected 3 queue triggers, found %', v_queue_trigger_count;
    ELSE
        RAISE NOTICE '✅ All 3 queue triggers successfully created and enabled';
    END IF;
END $$;

-- Final report
SELECT 
    'Async Queue Triggers' as migration,
    '✅ COMPLETE' as status,
    '3 sync triggers disabled → 3 queue triggers active' as summary;
