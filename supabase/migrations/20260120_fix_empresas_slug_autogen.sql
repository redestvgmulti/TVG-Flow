-- Migration: Fix Empresas Slug Autogen
-- Description: Creates a trigger to automatically generate a slug for new companies if not provided.
-- Author: Antigravity

-- 1. Create reusable function to generate slug from name
CREATE OR REPLACE FUNCTION generate_empresa_slug_if_missing()
RETURNS TRIGGER AS $$
BEGIN
    -- Only generate if slug is null or empty string
    IF NEW.slug IS NULL OR NEW.slug = '' THEN
        -- Generate slug: lowercase, replace non-alphanumeric with hyphen, remove leading/trailing hyphens
        NEW.slug := lower(
            regexp_replace(
                regexp_replace(NEW.nome, '[^a-zA-Z0-9]+', '-', 'g'),
                '(^-|-$)', '', 'g'
            )
        );
        
        -- Fallback for empty result (e.g. if name was only special chars)
        IF NEW.slug IS NULL OR NEW.slug = '' THEN
             NEW.slug := 'empresa-' || gen_random_uuid();
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Create Trigger BEFORE INSERT
DROP TRIGGER IF EXISTS trg_generate_empresa_slug ON empresas;

CREATE TRIGGER trg_generate_empresa_slug
BEFORE INSERT ON empresas
FOR EACH ROW
EXECUTE FUNCTION generate_empresa_slug_if_missing();
