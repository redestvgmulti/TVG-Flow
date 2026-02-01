-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: VALIDATE PARTICIPANT EMPRESA
-- Date: 2026-01-18
-- Status: PRODUCTION-SAFE | DEFENSIVE | REJECTS INVALID ONLY
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PURPOSE: Prevent cross-tenant participant assignments
-- SAFETY: Only rejects NEW invalid inserts, existing data untouched
-- IMPACT: Zero impact on valid data
-- 
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Function to validate participant belongs to meeting's company
CREATE OR REPLACE FUNCTION validate_participant_empresa()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if participant's empresa matches meeting's empresa
    IF NOT EXISTS (
        SELECT 1
        FROM reunioes r
        INNER JOIN empresa_profissionais ep 
            ON ep.empresa_id = r.empresa_id 
            AND ep.profissional_id = NEW.profissional_id
WHERE r.id = NEW.reuniao_id
    ) THEN
        RAISE EXCEPTION 'Participante não pertence à empresa da reunião (cross-tenant violation)';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION validate_participant_empresa IS 
'Validates that meeting participants belong to the same company as the meeting. Prevents cross-tenant data leaks.';

-- Create trigger (only affects NEW inserts/updates)
CREATE TRIGGER check_participant_empresa
    BEFORE INSERT OR UPDATE ON reunioes_participantes
    FOR EACH ROW
    EXECUTE FUNCTION validate_participant_empresa();

COMMENT ON TRIGGER check_participant_empresa ON reunioes_participantes IS
'Defensive trigger to prevent cross-tenant participant assignments. Only affects new operations, existing data is preserved.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- SAFETY NOTES:
-- - Existing valid data is NOT affected
-- - Only FUTURE invalid inserts will be rejected
-- - Frontend already prevents this via Admin policy, this is defensive
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
