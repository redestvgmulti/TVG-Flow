-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FlowOS - Backfill Professional Permissions
-- Populate empresa_profissionais_permitidos from existing data
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- Purpose: Migrate existing empresa_profissionais relationships to the new
--          permission-based model WITHOUT breaking current functionality.
--
-- Strategy:
--   1. For each professional linked to an operational company
--   2. Create a permission record allowing them to work on that company
--   3. Preserve existing UX while implementing the correct architecture
-- 
-- SAFETY:
--   - Uses ON CONFLICT DO NOTHING to be idempotent
--   - Only migrates operational companies (empresa_tipo = 'operacional')
--   - Does NOT modify or delete existing data
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Backfill permissions from existing empresa_profissionais links
INSERT INTO empresa_profissionais_permitidos (
  tenant_id,
  empresa_operacional_id,
  profissional_id,
  ativo,
  created_at
)
SELECT
  COALESCE(e.tenant_id, e.id) as tenant_id,  -- Resolve tenant_id correctly
  e.id as empresa_operacional_id,             -- The operational company
  ep.profissional_id,                          -- The professional
  ep.ativo,                                    -- Preserve active status
  ep.created_at                                -- Preserve creation timestamp
FROM empresa_profissionais ep
JOIN empresas e ON e.id = ep.empresa_id
WHERE e.empresa_tipo = 'operacional'          -- Only operational companies
  AND e.ativo = true                           -- Only active companies
  AND ep.ativo = true                          -- Only active relationships
ON CONFLICT (empresa_operacional_id, profissional_id) 
DO NOTHING;                                    -- Skip duplicates (idempotent)

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- VALIDATION QUERIES (for manual verification)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Count how many permissions were created
DO $$
DECLARE
  permission_count INT;
  source_count INT;
BEGIN
  SELECT COUNT(*) INTO permission_count 
  FROM empresa_profissionais_permitidos;
  
  SELECT COUNT(*) INTO source_count
  FROM empresa_profissionais ep
  JOIN empresas e ON e.id = ep.empresa_id
  WHERE e.empresa_tipo = 'operacional'
    AND e.ativo = true
    AND ep.ativo = true;
  
  RAISE NOTICE 'Backfill Complete:';
  RAISE NOTICE '  - Permissions created: %', permission_count;
  RAISE NOTICE '  - Source records processed: %', source_count;
  
  -- Validation: counts should match (assuming no pre-existing duplicates)
  IF permission_count < source_count THEN
    RAISE WARNING 'Permission count is lower than source count. This may indicate duplicates or conflicts.';
  END IF;
END $$;
