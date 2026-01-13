-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- FlowOS - HOTFIX: Backfill Function Permissions (Corrected)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 
-- Purpose: Populate empresa_funcoes_permitidas with existing function data
--
-- DIAGNOSIS: Previous backfill likely failed due to GROUP BY on aggregated field
-- FIX: Simplified query without MIN() aggregation
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- First, let's check what data exists in the source table
DO $$
DECLARE
  source_count INT;
  operational_company_count INT;
BEGIN
  -- Count distinct functions in empresa_profissionais
  SELECT COUNT(DISTINCT (ep.empresa_id, ep.funcao)) INTO source_count
  FROM empresa_profissionais ep
  JOIN empresas e ON e.id = ep.empresa_id
  WHERE ep.funcao IS NOT NULL
    AND ep.ativo = true
    AND e.ativo = true;
  
  -- Count operational companies
  SELECT COUNT(*) INTO operational_company_count
  FROM empresas
  WHERE empresa_tipo = 'operacional'
    AND ativo = true;
  
  RAISE NOTICE '=== DIAGNOSTIC INFO ===';
  RAISE NOTICE 'Distinct (company, function) pairs found: %', source_count;
  RAISE NOTICE 'Active operational companies: %', operational_company_count;
END $$;

-- Now perform the backfill with corrected query
INSERT INTO empresa_funcoes_permitidas (
  tenant_id,
  empresa_operacional_id,
  funcao,
  ativo
)
SELECT DISTINCT ON (e.id, ep.funcao)
  COALESCE(e.tenant_id, e.id) as tenant_id,
  e.id as empresa_operacional_id,
  ep.funcao,
  true as ativo
FROM empresa_profissionais ep
JOIN empresas e ON e.id = ep.empresa_id
WHERE ep.funcao IS NOT NULL
  AND ep.ativo = true
  AND e.ativo = true
ORDER BY e.id, ep.funcao, ep.created_at
ON CONFLICT (empresa_operacional_id, funcao) 
DO NOTHING;

-- Validation
DO $$
DECLARE
  inserted_count INT;
BEGIN
  SELECT COUNT(*) INTO inserted_count 
  FROM empresa_funcoes_permitidas;
  
  RAISE NOTICE '=== BACKFILL RESULT ===';
  RAISE NOTICE 'Function permissions created: %', inserted_count;
  
  IF inserted_count = 0 THEN
    RAISE WARNING 'NO FUNCTION PERMISSIONS CREATED! Check if empresa_profissionais has funcao data.';
  ELSE
    RAISE NOTICE 'SUCCESS: Function permissions backfilled successfully!';
  END IF;
END $$;
