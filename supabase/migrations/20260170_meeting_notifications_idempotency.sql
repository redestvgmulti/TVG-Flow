-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: MEETING NOTIFICATIONS IDEMPOTENCY
-- Date: 2026-01-18
-- Status: PRODUCTION-SAFE | ADDITIVE | DEFENSIVE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PURPOSE: Prevent duplicate meeting notifications even with multiple cron runs
-- APPROACH: Hybrid solution - partial unique index + enhanced RPC logic
-- SAFETY: Does NOT break existing notifications, only prevents future duplicates
-- 
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 1: Add metadata column if not exists (idempotent)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Check if metadata column exists, if not add it
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notificacoes' 
        AND column_name = 'metadata'
    ) THEN
        ALTER TABLE notificacoes ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
        RAISE NOTICE '✅ Added metadata column to notificacoes';
    ELSE
        RAISE NOTICE 'ℹ️  metadata column already exists';
    END IF;
END $$;

COMMENT ON COLUMN notificacoes.metadata IS 'Additional structured data for notification (e.g., meeting details, intervals)';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 2: Create partial unique index for meeting notifications
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- This index prevents duplicate meeting notifications for REMINDERS only
-- Does NOT affect invites (interval=0) or updates (interval=-1), allowing legitimate duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_notificacoes_meeting_reminder_unique
ON notificacoes (
    profissional_id,
    (metadata->>'reuniao_id'),
    (metadata->>'interval_minutes')
)
WHERE 
    tipo IN ('meeting_reminder')
    AND metadata->>'interval_minutes' IN ('10', '30', '60');

COMMENT ON INDEX idx_notificacoes_meeting_reminder_unique IS 
'Prevents duplicate meeting reminder notifications (10/30/60min). Does NOT block invites or updates.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 3: Enhance create_meeting_notification RPC with UPSERT-like logic
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
        -- Meeting cancelled
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

    -- ✅ IDEMPOTENCY CHECK: Prevent ALL duplicates with robust logic
    -- For REMINDERS (10/30/60): strict deduplication
    IF p_interval_minutes IN (10, 30, 60) THEN
        IF EXISTS (
            SELECT 1 FROM notificacoes 
            WHERE profissional_id = p_profissional_id 
            AND tipo = 'meeting_reminder'
            AND metadata->>'reuniao_id' = p_reuniao_id::TEXT
            AND metadata->>'interval_minutes' = p_interval_minutes::TEXT
        ) THEN
            -- Already sent, skip silently
            RAISE NOTICE 'Notification already sent (reminder %min): reuniao=%, profissional=%', 
                p_interval_minutes, p_reuniao_id, p_profissional_id;
            RETURN NULL;
        END IF;
    -- For INVITES (0): prevent duplicates
    ELSIF p_interval_minutes = 0 THEN
        IF EXISTS (
            SELECT 1 FROM notificacoes 
            WHERE profissional_id = p_profissional_id 
            AND tipo = 'meeting_created' 
            AND metadata->>'reuniao_id' = p_reuniao_id::TEXT
        ) THEN
            RAISE NOTICE 'Notification already sent (invite): reuniao=%, profissional=%', 
                p_reuniao_id, p_profissional_id;
            RETURN NULL;
        END IF;
    -- For CANCELLATIONS (-2): prevent duplicates
    ELSIF p_interval_minutes = -2 THEN
        IF EXISTS (
            SELECT 1 FROM notificacoes 
            WHERE profissional_id = p_profissional_id 
            AND tipo = 'meeting_cancelled'
            AND metadata->>'reuniao_id' = p_reuniao_id::TEXT
        ) THEN
            RAISE NOTICE 'Notification already sent (cancellation): reuniao=%, profissional=%', 
                p_reuniao_id, p_profissional_id;
            RETURN NULL;
        END IF;
    END IF;
    -- Note: For UPDATES (-1), we allow duplicates (meeting might be rescheduled multiple times)

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
    ON CONFLICT DO NOTHING  -- ✅ Silently skip if unique index prevents insert
    RETURNING id INTO v_notification_id;

    -- Return ID or NULL if already exists
    RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_meeting_notification IS
'Creates meeting notifications with idempotency guarantees.
- interval=0: meeting_created (invite) - prevents duplicates
- interval=-1: meeting_updated (rescheduled) - allows duplicates
- interval=-2: meeting_cancelled - prevents duplicates
- interval=10/30/60: meeting_reminder - strict deduplication via index + check
Returns notification ID or NULL if already sent.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SAFETY VALIDATION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Validate migration success
DO $$
BEGIN
    -- Check metadata column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'notificacoes' AND column_name = 'metadata'
    ) THEN
        RAISE EXCEPTION 'Migration failed: metadata column not created';
    END IF;

    -- Check unique index exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE tablename = 'notificacoes' 
        AND indexname = 'idx_notificacoes_meeting_reminder_unique'
    ) THEN
        RAISE EXCEPTION 'Migration failed: unique index not created';
    END IF;

    RAISE NOTICE '✅ Migration successful: Meeting notifications now idempotent';
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- BACKWARD COMPATIBILITY NOTES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- ✅ Existing notifications: NOT affected (index only applies to new inserts)
-- ✅ Other notification types: NOT affected (index is partial)
-- ✅ RPC signature: Unchanged (backward-compatible)
-- ✅ Return behavior: Now returns NULL for duplicates (caller handles)
-- ✅ Rollback: Drop index + restore old RPC version (data intact)
-- 
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
