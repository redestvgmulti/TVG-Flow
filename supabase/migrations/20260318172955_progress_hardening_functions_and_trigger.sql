
-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1: Functions, guard trigger, consistency sweep
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Standalone recalculate function
CREATE OR REPLACE FUNCTION public.recalculate_task_progress(p_task_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_weight     INTEGER;
    v_completed_weight INTEGER;
    v_new_progress     INTEGER;
BEGIN
    SELECT
        COALESCE(SUM(peso), 0),
        COALESCE(SUM(CASE WHEN status = 'concluida' THEN peso ELSE 0 END), 0)
    INTO v_total_weight, v_completed_weight
    FROM tarefas_micro
    WHERE tarefa_id = p_task_id;

    IF v_total_weight > 0 THEN
        v_new_progress := (v_completed_weight * 100) / v_total_weight;
    ELSE
        v_new_progress := 0;
    END IF;

    UPDATE tarefas
    SET progress   = v_new_progress,
        updated_at = NOW()
    WHERE id = p_task_id;

    RETURN v_new_progress;
END;
$$;

-- 2. Guard trigger: block manual progress writes, recompute silently
CREATE OR REPLACE FUNCTION public.tg_guard_manual_progress()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Allow writes that come from our own trigger (flag set by update_macro_task_progress)
    IF current_setting('app.allow_progress_write', TRUE) = 'true' THEN
        RETURN NEW;
    END IF;

    -- If external code tried to change progress, override with computed value
    IF OLD.progress IS DISTINCT FROM NEW.progress THEN
        NEW.progress := (
            SELECT COALESCE(
                (SUM(CASE WHEN status = 'concluida' THEN peso ELSE 0 END) * 100)
                    / NULLIF(SUM(peso), 0),
                0
            )::INTEGER
            FROM tarefas_micro
            WHERE tarefa_id = NEW.id
        );
        RAISE NOTICE '[PROGRESS_GUARD] Manual write blocked for task %. Recomputed: %', NEW.id, NEW.progress;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_manual_progress ON tarefas;
CREATE TRIGGER trg_guard_manual_progress
    BEFORE UPDATE OF progress ON tarefas
    FOR EACH ROW
    EXECUTE FUNCTION tg_guard_manual_progress();

-- 3. Consistency sweep function for cron + ad-hoc use
CREATE OR REPLACE FUNCTION public.sweep_progress_inconsistencies()
RETURNS TABLE(task_id UUID, old_progress INT, new_progress INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_task     RECORD;
    v_expected INTEGER;
BEGIN
    FOR v_task IN
        SELECT t.id, t.progress, t.titulo
        FROM tarefas t
        WHERE t.status NOT IN ('cancelada', 'concluida')
          AND EXISTS (SELECT 1 FROM tarefas_micro tm WHERE tm.tarefa_id = t.id)
    LOOP
        SELECT COALESCE(
            (SUM(CASE WHEN status = 'concluida' THEN peso ELSE 0 END) * 100)
                / NULLIF(SUM(peso), 0),
            0
        )::INTEGER
        INTO v_expected
        FROM tarefas_micro
        WHERE tarefa_id = v_task.id;

        IF COALESCE(v_task.progress, 0) != v_expected THEN
            UPDATE tarefas
            SET progress   = v_expected,
                updated_at = NOW()
            WHERE id = v_task.id;

            RAISE LOG '[PROGRESS_SWEEP] Drift fixed: "%" id=% % -> %',
                v_task.titulo, v_task.id, v_task.progress, v_expected;

            task_id      := v_task.id;
            old_progress := COALESCE(v_task.progress, 0);
            new_progress := v_expected;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$;

-- 4. Immediate repair of the 1 known drifted task (GRAVAÇÃO MARIA E EVANDRO)
SELECT public.recalculate_task_progress('bd03c3ac-f911-4f83-804a-b06a194ecac1');
;
