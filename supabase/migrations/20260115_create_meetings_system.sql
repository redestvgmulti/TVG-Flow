-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: MEETINGS SYSTEM (Aba Reuniões)
-- Created: 2026-01-15
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PURPOSE: Implement in-person meeting management system
-- FEATURES:
--   - Admin can create meetings and select participants
--   - Staff can only view meetings where they are participants
--   - Meetings appear in Agenda (calendar)
--   - Automated notifications: 60min, 30min, 10min before start
--   - RLS enforces tenant isolation and participant access
-- 
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 1: CREATE TABLES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Table: reunioes
-- Stores meeting information
CREATE TABLE IF NOT EXISTS reunioes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    titulo TEXT NOT NULL,
    descricao TEXT,
    data_inicio TIMESTAMPTZ NOT NULL,
    data_fim TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    criada_por UUID NOT NULL REFERENCES profissionais(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT reunioes_valid_time CHECK (data_fim > data_inicio)
);

-- Table: reunioes_participantes
-- Stores meeting participants (many-to-many relationship)
CREATE TABLE IF NOT EXISTS reunioes_participantes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reuniao_id UUID NOT NULL REFERENCES reunioes(id) ON DELETE CASCADE,
    profissional_id UUID NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
    confirmado BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Prevent duplicate participants
    CONSTRAINT reunioes_participantes_unique UNIQUE (reuniao_id, profissional_id)
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 2: CREATE INDEXES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Performance indexes for common queries
CREATE INDEX IF NOT EXISTS idx_reunioes_empresa_id ON reunioes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_reunioes_data_inicio ON reunioes(data_inicio);
CREATE INDEX IF NOT EXISTS idx_reunioes_status ON reunioes(status);
CREATE INDEX IF NOT EXISTS idx_reunioes_criada_por ON reunioes(criada_por);

-- Composite index for calendar queries (empresa + date)
CREATE INDEX IF NOT EXISTS idx_reunioes_empresa_data ON reunioes(empresa_id, data_inicio);

-- Participant lookup indexes
CREATE INDEX IF NOT EXISTS idx_reunioes_participantes_reuniao ON reunioes_participantes(reuniao_id);
CREATE INDEX IF NOT EXISTS idx_reunioes_participantes_profissional ON reunioes_participantes(profissional_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 3: ENABLE ROW LEVEL SECURITY
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER TABLE reunioes ENABLE ROW LEVEL SECURITY;
ALTER TABLE reunioes_participantes ENABLE ROW LEVEL SECURITY;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 4: RLS POLICIES - REUNIOES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Helper function: Check if user is admin in a company
CREATE OR REPLACE FUNCTION is_admin_in_empresa(empresa_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM empresa_profissionais ep
        INNER JOIN profissionais p ON ep.profissional_id = p.id
        WHERE ep.empresa_id = empresa_uuid
            AND p.id = auth.uid()
            AND p.role IN ('admin', 'super_admin')
            AND ep.ativo = TRUE
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Helper function: Check if user is participant in a meeting
CREATE OR REPLACE FUNCTION is_meeting_participant(reuniao_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM reunioes_participantes rp
        WHERE rp.reuniao_id = reuniao_uuid
            AND rp.profissional_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- POLICY: Admin SELECT - can view all meetings in their empresa
CREATE POLICY "Admin can view all company meetings"
    ON reunioes FOR SELECT
    USING (is_admin_in_empresa(empresa_id));

-- POLICY: Staff SELECT - can only view meetings where they are participants
CREATE POLICY "Staff can view meetings where they are participants"
    ON reunioes FOR SELECT
    USING (is_meeting_participant(id));

-- POLICY: Admin INSERT - can create meetings in their empresa
CREATE POLICY "Admin can create meetings"
    ON reunioes FOR INSERT
    WITH CHECK (is_admin_in_empresa(empresa_id));

-- POLICY: Admin UPDATE - can update meetings in their empresa
CREATE POLICY "Admin can update company meetings"
    ON reunioes FOR UPDATE
    USING (is_admin_in_empresa(empresa_id))
    WITH CHECK (is_admin_in_empresa(empresa_id));

-- POLICY: Admin DELETE - can delete meetings in their empresa
CREATE POLICY "Admin can delete company meetings"
    ON reunioes FOR DELETE
    USING (is_admin_in_empresa(empresa_id));

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 5: RLS POLICIES - REUNIOES_PARTICIPANTES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- POLICY: SELECT - can view participants if you can view the meeting
CREATE POLICY "Can view participants if can view meeting"
    ON reunioes_participantes FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM reunioes r
            WHERE r.id = reuniao_id
        )
    );

-- POLICY: Admin INSERT - can add participants to company meetings
CREATE POLICY "Admin can add participants"
    ON reunioes_participantes FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM reunioes r
            WHERE r.id = reuniao_id
                AND is_admin_in_empresa(r.empresa_id)
        )
    );

-- POLICY: Admin UPDATE - can update participants in company meetings
CREATE POLICY "Admin can update participants"
    ON reunioes_participantes FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM reunioes r
            WHERE r.id = reuniao_id
                AND is_admin_in_empresa(r.empresa_id)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM reunioes r
            WHERE r.id = reuniao_id
                AND is_admin_in_empresa(r.empresa_id)
        )
    );

-- POLICY: Admin DELETE - can remove participants from company meetings
CREATE POLICY "Admin can remove participants"
    ON reunioes_participantes FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM reunioes r
            WHERE r.id = reuniao_id
                AND is_admin_in_empresa(r.empresa_id)
        )
    );

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 6: NOTIFICATION RPC FUNCTIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- RPC: Get upcoming meeting notifications
-- Returns meetings that need reminders at specified interval
CREATE OR REPLACE FUNCTION get_upcoming_meeting_notifications(
    interval_minutes INT
)
RETURNS TABLE (
    reuniao_id UUID,
    profissional_id UUID,
    profissional_nome TEXT,
    titulo TEXT,
    data_inicio TIMESTAMPTZ,
    minutes_until_start INT,
    notification_interval INT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id AS reuniao_id,
        rp.profissional_id,
        p.nome AS profissional_nome,
        r.titulo,
        r.data_inicio,
        EXTRACT(EPOCH FROM (r.data_inicio - NOW())) / 60 AS minutes_until_start,
        interval_minutes AS notification_interval
    FROM reunioes r
    INNER JOIN reunioes_participantes rp ON r.id = rp.reuniao_id
    INNER JOIN profissionais p ON rp.profissional_id = p.id
    WHERE 
        -- Only scheduled meetings
        r.status = 'scheduled'
        -- Meeting is in the future
        AND r.data_inicio > NOW()
        -- Meeting is within the notification window
        AND r.data_inicio <= NOW() + MAKE_INTERVAL(mins => interval_minutes)
        -- Meeting is at least close to the notification interval (allow 5min buffer)
        AND r.data_inicio >= NOW() + MAKE_INTERVAL(mins => interval_minutes - 5)
        -- Check if notification not already sent for this interval
        AND NOT EXISTS (
            SELECT 1 FROM notificacoes n
            WHERE n.profissional_id = rp.profissional_id
                AND n.tipo = 'meeting_reminder'
                AND n.metadata->>'reuniao_id' = r.id::TEXT
                AND n.metadata->>'interval_minutes' = interval_minutes::TEXT
                AND n.created_at > NOW() - INTERVAL '2 hours' -- Don't re-notify within 2 hours
        )
    ORDER BY r.data_inicio ASC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_upcoming_meeting_notifications IS 
'Returns meetings that need reminder notifications at specified interval.
Filters out cancelled/completed meetings and already-notified participants.
Participants are notified only for meetings where they are listed.';

-- RPC: Create meeting notification
-- Inserts notification for a meeting participant
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
BEGIN
    -- Build clear, professional message (no emojis)
    IF p_interval_minutes = 60 THEN
        v_message := format('Reunião "%s" começa em 1 hora', p_titulo);
    ELSIF p_interval_minutes = 30 THEN
        v_message := format('Reunião "%s" começa em 30 minutos', p_titulo);
    ELSIF p_interval_minutes = 10 THEN
        v_message := format('Reunião "%s" começa em 10 minutos', p_titulo);
    ELSE
        v_message := format('Lembrete: Reunião "%s" está próxima', p_titulo);
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
        'meeting_reminder',
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
'Creates a meeting reminder notification for a participant.
Message is clear and professional without emojis.
Stores metadata for deduplication and tracking.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 7: GRANT PERMISSIONS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Allow Edge Functions (service role) to call notification RPCs
GRANT EXECUTE ON FUNCTION get_upcoming_meeting_notifications(INT) TO service_role;
GRANT EXECUTE ON FUNCTION create_meeting_notification(UUID, UUID, TEXT, TIMESTAMPTZ, INT) TO service_role;

-- Allow authenticated users to call helper functions
GRANT EXECUTE ON FUNCTION is_admin_in_empresa(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_meeting_participant(UUID) TO authenticated;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 8: ENABLE REALTIME (for live notifications)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ALTER PUBLICATION supabase_realtime ADD TABLE reunioes;
ALTER PUBLICATION supabase_realtime ADD TABLE reunioes_participantes;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- STEP 9: COMMENTS
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COMMENT ON TABLE reunioes IS 'In-person meetings - Admin creates, Staff participates';
COMMENT ON TABLE reunioes_participantes IS 'Meeting participants - Many-to-many relationship';

COMMENT ON COLUMN reunioes.empresa_id IS 'Company that owns this meeting';
COMMENT ON COLUMN reunioes.titulo IS 'Meeting title';
COMMENT ON COLUMN reunioes.descricao IS 'Meeting description/agenda';
COMMENT ON COLUMN reunioes.data_inicio IS 'Meeting start time';
COMMENT ON COLUMN reunioes.data_fim IS 'Meeting end time';
COMMENT ON COLUMN reunioes.status IS 'scheduled | completed | cancelled';
COMMENT ON COLUMN reunioes.criada_por IS 'Admin who created the meeting';

COMMENT ON COLUMN reunioes_participantes.confirmado IS 'Whether participant confirmed attendance';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION COMPLETE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
