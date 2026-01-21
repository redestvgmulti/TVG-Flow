-- Migration: Add UNIQUE constraint to empresa_profissionais
-- Description: Ensures one-to-one mapping between company and professional, enabling safe ON CONFLICT clauses.
-- This migration is idempotent and safe for production (non-destructive).

DO $$
BEGIN
    -- Check if constraint already exists to avoid errors on re-run
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'empresa_profissionais_unique'
    ) THEN
        -- Attempt to add the constraint.
        -- If duplicate data exists, this will FAIL safely (rolling back the transaction),
        -- protecting the existing data as requested by the user.
        ALTER TABLE empresa_profissionais
        ADD CONSTRAINT empresa_profissionais_unique UNIQUE (empresa_id, profissional_id);
    END IF;
END $$;
