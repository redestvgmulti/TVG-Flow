-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: ADD METADATA COLUMN (PRE-REQUISITE)
-- Date: 2026-01-18
-- Status: PRODUCTION-SAFE | ADDITIVE
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
