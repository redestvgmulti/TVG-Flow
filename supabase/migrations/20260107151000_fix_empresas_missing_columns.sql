-- Migration: Add missing columns to empresas table
-- Reason: Frontend expects slug and logo_url but they don't exist
-- Date: 2026-01-07

-- Add slug column (unique identifier for URLs)
ALTER TABLE empresas 
ADD COLUMN IF NOT EXISTS slug VARCHAR(255);

-- Add logo_url column (optional company logo)
ALTER TABLE empresas 
ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Generate slugs for existing companies with uniqueness handling
-- First, create base slugs
UPDATE empresas 
SET slug = lower(regexp_replace(nome, '[^a-zA-Z0-9]+', '-', 'g'))
WHERE slug IS NULL;

-- Handle duplicates by appending row number
WITH numbered_empresas AS (
  SELECT 
    id, 
    slug,
    ROW_NUMBER() OVER (PARTITION BY slug ORDER BY created_at) as rn
  FROM empresas
  WHERE slug IS NOT NULL
)
UPDATE empresas e
SET slug = CASE 
  WHEN ne.rn > 1 THEN e.slug || '-' || ne.rn::text
  ELSE e.slug
END
FROM numbered_empresas ne
WHERE e.id = ne.id AND ne.rn > 1;

-- Make slug NOT NULL and unique
ALTER TABLE empresas 
ALTER COLUMN slug SET NOT NULL;

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'empresas_slug_unique'
  ) THEN
    ALTER TABLE empresas ADD CONSTRAINT empresas_slug_unique UNIQUE (slug);
  END IF;
END $$;

-- Index for slug lookups
CREATE INDEX IF NOT EXISTS idx_empresas_slug ON empresas(slug);
