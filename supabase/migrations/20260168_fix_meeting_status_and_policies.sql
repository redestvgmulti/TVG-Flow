-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: FIX MEETING STATUS AND POLICIES
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. FIX CHECK CONSTRAINT AND NORMALIZE STATUS
ALTER TABLE reunioes DROP CONSTRAINT IF EXISTS reunioes_status_check;

UPDATE reunioes SET status = 'agendada' WHERE status = 'scheduled';
UPDATE reunioes SET status = 'cancelada' WHERE status = 'cancelled';
UPDATE reunioes SET status = 'realizada' WHERE status = 'completed';

-- Add new constraint with PT-BR values
ALTER TABLE reunioes ADD CONSTRAINT reunioes_status_check 
    CHECK (status IN ('agendada', 'em_andamento', 'realizada', 'cancelada'));

-- 2. UPDATE RLS POLICY FOR CHECK-IN
-- Staff can only confirm presence if meeting is active and not ended
DROP POLICY IF EXISTS "Staff can confirm presence" ON reunioes_participantes;
CREATE POLICY "Staff can confirm presence"
    ON reunioes_participantes FOR UPDATE
    USING (
        profissional_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM reunioes r
            WHERE r.id = reunioes_participantes.reuniao_id
            AND r.status IN ('agendada', 'em_andamento')
            AND r.cancelled_at IS NULL
            AND NOW() <= r.data_fim
        )
    )
    WITH CHECK (
        profissional_id = auth.uid()
        AND EXISTS (
             SELECT 1 FROM reunioes r
             WHERE r.id = reunioes_participantes.reuniao_id
             AND r.status IN ('agendada', 'em_andamento')
             AND r.cancelled_at IS NULL
             AND NOW() <= r.data_fim
        )
    );

-- 3. IDEMPOTENT AUTO-CLOSE FUNCTION
CREATE OR REPLACE FUNCTION auto_close_meetings()
RETURNS VOID AS $$
BEGIN
    UPDATE reunioes
    SET status = 'realizada'
    WHERE data_fim < NOW()
    AND status IN ('agendada', 'em_andamento')
    AND cancelled_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
