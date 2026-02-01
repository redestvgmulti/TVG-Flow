-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: INSTITUTIONAL MEETING FEATURES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. SCHEMA UPDATES
ALTER TABLE reunioes 
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id);

ALTER TABLE reunioes_participantes 
ADD COLUMN IF NOT EXISTS participou BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS checked_at TIMESTAMPTZ;

-- 2. RLS POLICIES

-- Policy: Admin can update meetings they created (for cancellation/time change)
DROP POLICY IF EXISTS "Admin can update own meetings" ON reunioes;
CREATE POLICY "Admin can update own meetings"
    ON reunioes FOR UPDATE
    USING (criada_por = auth.uid()); -- or is_admin_in_empresa logic if broader

-- Policy: Staff can update their own participation (Check-in)
DROP POLICY IF EXISTS "Staff can confirm presence" ON reunioes_participantes;
CREATE POLICY "Staff can confirm presence"
    ON reunioes_participantes FOR UPDATE
    USING (profissional_id = auth.uid())
    WITH CHECK (profissional_id = auth.uid());

-- 3. FUNCTIONS

-- Function to Auto-Close Meetings (Job)
CREATE OR REPLACE FUNCTION auto_close_meetings()
RETURNS VOID AS $$
BEGIN
    UPDATE reunioes
    SET status = 'realizada'
    WHERE status = 'scheduled'
    AND data_fim < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attempt to schedule via pg_cron (if available)
-- We wrap in DO block to avoid error if extension missing
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule('close_meetings_job', '*/5 * * * *', 'SELECT auto_close_meetings()');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available or schedule failed';
END $$;

-- Update Notification RPC to support 'Update' (-1)
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
    v_date_str := to_char(p_data_inicio AT TIME ZONE 'America/Sao_Paulo', 'DD/MM');
    v_time_str := to_char(p_data_inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI');

    IF p_interval_minutes = 0 THEN
        v_tipo := 'meeting_created';
        v_message := format('Você foi incluído na reunião "%s". Data: %s às %s.', p_titulo, v_date_str, v_time_str);
    ELSIF p_interval_minutes = -1 THEN
        v_tipo := 'meeting_updated';
        v_message := format('Reunião "%s" foi alterada para %s às %s.', p_titulo, v_date_str, v_time_str);
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

    -- For updates (-1), we might want to allow duplicates if date changed multiple times?
    -- Current logic detects duplicate by type/meeting/interval.
    -- If we use -1, subsequent updates might be blocked if we don't clear old metadata?
    -- But metadata stores 'interval_minutes'.
    -- The requirement is to notify.
    -- We'll allow it. But simple duplicate check might block.
    -- Let's relax check for -1.
    IF p_interval_minutes = 0 THEN
         IF EXISTS (SELECT 1 FROM notificacoes WHERE profissional_id = p_profissional_id AND tipo = 'meeting_created' AND metadata->>'reuniao_id' = p_reuniao_id::TEXT) THEN
            RETURN NULL;
         END IF;
    END IF;

    INSERT INTO notificacoes (
        profissional_id, tipo, mensagem, metadata, lida, created_at
    ) VALUES (
        p_profissional_id, v_tipo, v_message,
        jsonb_build_object('reuniao_id', p_reuniao_id, 'titulo', p_titulo, 'data_inicio', p_data_inicio, 'interval_minutes', p_interval_minutes),
        FALSE, NOW()
    )
    RETURNING id INTO v_notification_id;

    RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
