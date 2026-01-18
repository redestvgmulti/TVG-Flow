-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: SUPPORT MEETING CANCELLATION NOTIFICATIONS
-- Date: 2026-01-18
-- Status: PRODUCTION-SAFE | ADDITIVE | EXTENDS EXISTING RPC
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PURPOSE: Add support for interval_minutes = -2 (cancellation)
-- SAFETY: Extends existing RPC, does not alter current behavior
-- IMPACT: Zero impact on existing notifications
-- 
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Extend create_meeting_notification to support cancellation
-- This replaces the existing function with extended capability
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
    v_date_str := to_char(p_data_inicio AT TIME ZONE 'America/Sao_Paulo', 'DD/MM');
    v_time_str := to_char(p_data_inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI');

    -- Build message based on interval
    IF p_interval_minutes = 0 THEN
        -- Meeting invite
        v_tipo := 'meeting_created';
        v_message := format('Você foi incluído na reunião "%s". Data: %s às %s.', p_titulo, v_date_str, v_time_str);
    ELSIF p_interval_minutes = -1 THEN
        -- Meeting updated
        v_tipo := 'meeting_updated';
        v_message := format('Reunião "%s" foi alterada para %s às %s.', p_titulo, v_date_str, v_time_str);
    ELSIF p_interval_minutes = -2 THEN
        -- ✅ NEW: Meeting cancelled
        v_tipo := 'meeting_cancelled';
        v_message := format('Reunião "%s" agendada para %s às %s foi cancelada.', p_titulo, v_date_str, v_time_str);
    ELSIF p_interval_minutes = 60 THEN
        -- 60min reminder
        v_tipo := 'meeting_reminder';
        v_message := format('Reunião "%s" começa em 1 hora', p_titulo);
    ELSIF p_interval_minutes = 30 THEN
        -- 30min reminder
        v_tipo := 'meeting_reminder';
        v_message := format('Reunião "%s" começa em 30 minutos', p_titulo);
    ELSIF p_interval_minutes = 10 THEN
        -- 10min reminder
        v_tipo := 'meeting_reminder';
        v_message := format('Reunião "%s" começa em 10 minutos', p_titulo);
    ELSE
        -- Generic reminder
        v_tipo := 'meeting_reminder';
        v_message := format('Lembrete: Reunião "%s" está próxima', p_titulo);
    END IF;

    -- Prevent duplicate invites only
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
'Creates meeting notifications. Supports:
- interval=0: meeting_created (invite)
- interval=-1: meeting_updated (rescheduled)
- interval=-2: meeting_cancelled (NEW)
- interval=10/30/60: meeting_reminder';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SAFETY NOTES:
-- - Function signature unchanged (backward-compatible)
-- - Existing interval values (-1, 0, 10, 30, 60) work exactly as before
-- - New interval value (-2) is additive
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
