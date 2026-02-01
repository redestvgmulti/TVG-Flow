-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: MEETING INVITES NOTIFICATION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE OR REPLACE FUNCTION create_meeting_notification(
    p_reuniao_id UUID,
    p_profissional_id UUID,
    p_titulo TEXT,
    p_data_inicio TIMESTAMPTZ,
    p_interval_minutes INT
)
RETURNS UUID AS $$
DECLARE
    v_notification_id UUID;
    v_message TEXT;
    v_tipo TEXT;
    v_date_str TEXT;
    v_time_str TEXT;
BEGIN
    -- Format date and time for message (DD/MM at HH:MM)
    -- Note: This uses server time/locale, ideally we'd pass formatted strings,
    -- but for consistency with existing system we'll format here.
    -- Assuming -03 timezone for display or using simple formatting
    v_date_str := to_char(p_data_inicio AT TIME ZONE 'America/Sao_Paulo', 'DD/MM');
    v_time_str := to_char(p_data_inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI');

    -- Build clear, professional message (no emojis)
    IF p_interval_minutes = 0 THEN
        v_tipo := 'meeting_created';
        v_message := format('Você foi incluído na reunião "%s". Data: %s às %s.', p_titulo, v_date_str, v_time_str);
    ELSIF p_interval_minutes = 60 THEN
        v_tipo := 'meeting_reminder';
        v_message := format('Reunião "%s" começa em 1 hora', p_titulo);
    ELSIF p_interval_minutes = 30 THEN
        v_tipo := 'meeting_reminder';
        v_message := format('Reunião "%s" começa em 30 minutos', p_titulo);
    ELSIF p_interval_minutes = 10 THEN
        v_tipo := 'meeting_reminder';
        v_message := format('Reunião "%s" começa em 10 minutos', p_titulo);
    ELSE
        v_tipo := 'meeting_reminder';
        v_message := format('Lembrete: Reunião "%s" está próxima', p_titulo);
    END IF;

    -- Check for duplicates for invites (interval 0) to prevent spam
    IF p_interval_minutes = 0 THEN
        IF EXISTS (
            SELECT 1 FROM notificacoes 
            WHERE profissional_id = p_profissional_id 
            AND tipo = 'meeting_created' 
            AND metadata->>'reuniao_id' = p_reuniao_id::TEXT
        ) THEN
            RETURN NULL; -- Skip duplicate
        END IF;
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
        v_tipo,
        v_message,
        jsonb_build_object(
            'reuniao_id', p_reuniao_id,
            'titulo', p_titulo,
            'data_inicio', p_data_inicio,
            'interval_minutes', p_interval_minutes
        ),
        FALSE,
        NOW()
    )
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_meeting_notification IS
'Creates a meeting notification. Supports interval=0 for invites (meeting_created) and other intervals for reminders.';
