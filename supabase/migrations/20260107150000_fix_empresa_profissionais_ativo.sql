-- Migration: Add 'ativo' column to empresa_profissionais
-- Reason: Frontend filters by 'ativo=true' but column was missing
-- Date: 2026-01-07

ALTER TABLE empresa_profissionais 
ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;

-- Backfill existing rows (though default handles new ones, existing ones need to be set if not using default during add, but standard SQL ADD COLUMN ... DEFAULT ... fills it)
-- Just to be safe and explicit:
UPDATE empresa_profissionais SET ativo = true WHERE ativo IS NULL;

-- Index for performance since we filter by it
CREATE INDEX IF NOT EXISTS idx_empresa_profissionais_ativo ON empresa_profissionais(ativo);
