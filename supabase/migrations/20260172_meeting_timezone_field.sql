-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: ADD TIMEZONE FIELD TO REUNIOES
-- Date: 2026-01-18
-- Status: PRODUCTION-SAFE | ADDITIVE | BACKWARD-COMPATIBLE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- PURPOSE: Support multi-timezone meetings
-- SAFETY: Optional field with default preserves existing behavior
-- IMPACT: Zero breaking changes
-- 
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Add timezone field (optional, defaults to Brazil timezone)
ALTER TABLE reunioes
ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Sao_Paulo';

-- Add comment for documentation
COMMENT ON COLUMN reunioes.timezone IS 'Meeting timezone in IANA format (e.g., America/Sao_Paulo, America/Manaus). Optional field, default preserves current behavior for single-timezone companies.';

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VALIDATION: Field is non-critical, no constraints needed
-- Existing meetings automatically get default timezone
-- New meetings can specify custom timezone if needed
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
