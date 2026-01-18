-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FIX: MEETING NOTIFICATIONS - CAMPO TITULO OBRIGATÓRIO
-- Date: 2026-01-18
-- Status: HOTFIX - PRODUCTION CRITICAL
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PROBLEMA: RPC create_meeting_notification não preenchia campo 'titulo'
-- CAUSA: Tabela notificacoes tem titulo NOT NULL, mas RPC não inseria
-- SOLUÇÃO: Adicionar campo titulo no INSERT
-- 
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
    v_titulo_notif TEXT;  -- ✅ Novo: título da notificação
    v_date_str TEXT;
    v_time_str TEXT;
BEGIN
    -- Format date and time for message (DD/MM at HH:MM)
    v_date_str := to_char(p_data_inicio AT TIME ZONE 'America/Sao_Paulo', 'DD/MM');
    v_time_str := to_char(p_data_inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI');

    -- Build message and titulo based on interval
    IF p_interval_minutes = 0 THEN
        -- Meeting invite
        v_tipo := 'meeting_created';
        v_titulo_notif := 'Nova reunião';  -- ✅ Título curto
        v_message := format('Você foi incluído na reunião "%s". Data: %s às %s.', p_titulo, v_date_str, v_time_str);
    ELSIF p_interval_minutes = -1 THEN
        -- Meeting updated
        v_tipo := 'meeting_updated';
        v_titulo_notif := 'Reunião alterada';  -- ✅ Título curto
        v_message := format('Reunião "%s" foi alterada para %s às %s.', p_titulo, v_date_str, v_time_str);
    ELSIF p_interval_minutes = -2 THEN
        -- Meeting cancelled
        v_tipo := 'meeting_cancelled';
        v_titulo_notif := 'Reunião cancelada';  -- ✅ Título curto
        v_message := format('Reunião "%s" agendada para %s às %s foi cancelada.', p_titulo, v_date_str, v_time_str);
    ELSIF p_interval_minutes = 60 THEN
        -- 60min reminder
        v_tipo := 'meeting_reminder';
        v_titulo_notif := 'Reunião em 1 hora';  -- ✅ Título curto
        v_message := format('Reunião "%s" começa em 1 hora', p_titulo);
    ELSIF p_interval_minutes = 30 THEN
        -- 30min reminder
        v_tipo := 'meeting_reminder';
        v_titulo_notif := 'Reunião em 30 minutos';  -- ✅ Título curto
        v_message := format('Reunião "%s" começa em 30 minutos', p_titulo);
    ELSIF p_interval_minutes = 10 THEN
        -- 10min reminder
        v_tipo := 'meeting_reminder';
        v_titulo_notif := 'Reunião em 10 minutos';  -- ✅ Título curto
        v_message := format('Reunião "%s" começa em 10 minutos', p_titulo);
    ELSE
        -- Generic reminder
        v_tipo := 'meeting_reminder';
        v_titulo_notif := 'Lembrete de reunião';  -- ✅ Título curto
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

    -- ✅ FIX: Insert notification WITH titulo field
    INSERT INTO notificacoes (
        profissional_id,
        tipo,
        titulo,        -- ✅ ADICIONADO: campo obrigatório
        mensagem,
        metadata,
        lida,
        created_at
    ) VALUES (
        p_profissional_id,
        v_tipo,
        v_titulo_notif,  -- ✅ ADICIONADO: título curto da notificação
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
Returns notification ID or NULL if already sent.
FIXED: Now includes titulo field (NOT NULL constraint)';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VALIDATION
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Test the fixed RPC
DO $$
DECLARE
    v_reuniao_id UUID;
    v_profissional_id UUID;
    v_titulo TEXT;
    v_data_inicio TIMESTAMPTZ;
    v_result UUID;
BEGIN
    -- Get test data
    SELECT id, titulo, data_inicio 
    INTO v_reuniao_id, v_titulo, v_data_inicio
    FROM reunioes 
    ORDER BY created_at DESC 
    LIMIT 1;
    
    SELECT id INTO v_profissional_id
    FROM profissionais
    LIMIT 1;
    
    IF v_reuniao_id IS NOT NULL AND v_profissional_id IS NOT NULL THEN
        -- Test notification creation
        SELECT create_meeting_notification(
            v_reuniao_id,
            v_profissional_id,
            v_titulo || ' [TESTE FIX]',
            v_data_inicio,
            0  -- Convite
        ) INTO v_result;
        
        IF v_result IS NOT NULL THEN
            RAISE NOTICE '✅ FIX SUCCESSFUL: Notification created with ID %', v_result;
            
            -- Show the created notification
            RAISE NOTICE 'Checking notification...';
            PERFORM * FROM notificacoes WHERE id = v_result;
        ELSE
            RAISE NOTICE '⚠️  RPC returned NULL (may be duplicate or idempotent skip)';
        END IF;
    ELSE
        RAISE NOTICE '❌ No test data available';
    END IF;
END $$;
