-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION 050: DEADLINE NOTIFICATION SYSTEM
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PURPOSE: Implement smart deadline notifications for micro tasks
-- STRATEGY: Micro-task-first notifications (never notify macro tasks directly)
-- INTERVALS: 60min, 30min, 15min before deadline
-- SCHEDULER: Edge Function (not pg_cron)
-- 
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 1: CREATE RPC TO GET UPCOMING DEADLINE NOTIFICATIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION get_upcoming_deadline_notifications(
    interval_minutes INT
)
RETURNS TABLE (
    micro_task_id UUID,
    profissional_id UUID,
    profissional_nome TEXT,
    funcao TEXT,
    macro_task_titulo TEXT,
    deadline_at TIMESTAMPTZ,
    minutes_until_deadline INT,
    notification_interval INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        mt.id AS micro_task_id,
        mt.profissional_id,
        p.nome AS profissional_nome,
        mt.funcao,
        t.titulo AS macro_task_titulo,
        mt.deadline_at,
        EXTRACT(EPOCH FROM (mt.deadline_at - NOW())) / 60 AS minutes_until_deadline,
        interval_minutes AS notification_interval
    FROM tarefas_micro mt
    INNER JOIN profissionais p ON mt.profissional_id = p.id
    INNER JOIN tarefas t ON mt.tarefa_id = t.id
    WHERE 
        -- Only non-completed tasks
        mt.status != 'concluida'
        -- Deadline is in the future
        AND mt.deadline_at > NOW()
        -- Deadline is within the notification window
        AND mt.deadline_at <= NOW() + MAKE_INTERVAL(mins => interval_minutes)
        -- Deadline is at least close to the notification interval (allow 5min buffer)
        AND mt.deadline_at >= NOW() + MAKE_INTERVAL(mins => interval_minutes - 5)
        -- Has a deadline set (SLA tracked)
        AND mt.deadline_at IS NOT NULL
        -- Check if notification not already sent for this interval
        AND NOT EXISTS (
            SELECT 1 FROM notificacoes n
            WHERE n.profissional_id = mt.profissional_id
                AND n.tipo = 'deadline_reminder'
                AND n.metadata->>'micro_task_id' = mt.id::TEXT
                AND n.metadata->>'interval_minutes' = interval_minutes::TEXT
                AND n.created_at > NOW() - INTERVAL '2 hours' -- Don't re-notify within 2 hours
        )
    ORDER BY mt.deadline_at ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_upcoming_deadline_notifications IS 
'Returns micro tasks that need deadline reminder notifications. 
Filters out completed tasks and already-notified tasks.
Micro-task-first strategy: professionals are notified only for their assigned micro tasks.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 2: CREATE HELPER FUNCTION TO INSERT DEADLINE NOTIFICATION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION create_deadline_notification(
    p_micro_task_id UUID,
    p_profissional_id UUID,
    p_funcao TEXT,
    p_macro_task_titulo TEXT,
    p_deadline_at TIMESTAMPTZ,
    p_interval_minutes INT
)
RETURNS UUID AS $$
DECLARE
    v_notification_id UUID;
    v_message TEXT;
    v_urgency_icon TEXT;
BEGIN
    -- Determine message and icon based on interval
    IF p_interval_minutes = 60 THEN
        v_urgency_icon := '⏰';
        v_message := format('%s Sua tarefa "%s" vence em 1 hora', v_urgency_icon, p_funcao);
    ELSIF p_interval_minutes = 30 THEN
        v_urgency_icon := '⚠️';
        v_message := format('%s Sua tarefa "%s" vence em 30 minutos', v_urgency_icon, p_funcao);
    ELSIF p_interval_minutes = 15 THEN
        v_urgency_icon := '🔴';
        v_message := format('%s URGENTE: Sua tarefa "%s" vence em 15 minutos!', v_urgency_icon, p_funcao);
    ELSE
        v_message := format('Lembrete: Sua tarefa "%s" está próxima do prazo', p_funcao);
    END IF;

    -- Insert notification
    INSERT INTO notificacoes (
        profissional_id,
        tipo,
        mensagem,
        metadata,
        lida,
        created_at
    ) VALUES (
        p_profissional_id,
        'deadline_reminder',
        v_message,
        jsonb_build_object(
            'micro_task_id', p_micro_task_id,
            'funcao', p_funcao,
            'macro_task_titulo', p_macro_task_titulo,
            'deadline_at', p_deadline_at,
            'interval_minutes', p_interval_minutes,
            'urgency', CASE 
                WHEN p_interval_minutes = 15 THEN 'high'
                WHEN p_interval_minutes = 30 THEN 'medium'
                ELSE 'low'
            END
        ),
        FALSE,
        NOW()
    )
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_deadline_notification IS
'Creates a deadline reminder notification for a micro task.
Message varies based on time until deadline (1h, 30m, 15m).
Stores metadata for deduplication and tracking.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 3: GRANT PERMISSIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Allow Edge Functions (service role) to call these functions
GRANT EXECUTE ON FUNCTION get_upcoming_deadline_notifications(INT) TO service_role;
GRANT EXECUTE ON FUNCTION create_deadline_notification(UUID, UUID, TEXT, TEXT, TIMESTAMPTZ, INT) TO service_role;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VERIFICATION QUERIES (FOR TESTING)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Test: Get notifications for tasks expiring in next hour
-- SELECT * FROM get_upcoming_deadline_notifications(60);

-- Test: Get notifications for tasks expiring in next 30min
-- SELECT * FROM get_upcoming_deadline_notifications(30);

-- Test: Get notifications for tasks expiring in next 15min
-- SELECT * FROM get_upcoming_deadline_notifications(15);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION 050 COMPLETE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
