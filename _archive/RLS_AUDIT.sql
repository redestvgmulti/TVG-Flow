-- =====================================================
-- RLS AUDIT - Multi-Tenant Isolation Verification
-- =====================================================
-- CRITICAL: Run this query while logged in as an Admin
-- to verify that RLS policies prevent cross-tenant data access
-- =====================================================

-- STEP 1: Get your current tenant_id and verify isolation in one query
-- This uses a CTE (Common Table Expression) to avoid manual placeholder replacement
WITH my_tenant AS (
  SELECT ep.empresa_id as tenant_id
  FROM empresa_profissionais ep
  JOIN empresas e ON e.id = ep.empresa_id
  WHERE ep.profissional_id = auth.uid()
  AND e.empresa_tipo = 'tenant'
  LIMIT 1
)
SELECT 
  'My Tenant ID' as info,
  tenant_id::text as value
FROM my_tenant;

-- =====================================================
-- STEP 2: CRITICAL ISOLATION TEST
-- This should return ZERO rows if RLS is working correctly
-- =====================================================
WITH my_tenant AS (
  SELECT ep.empresa_id as tenant_id
  FROM empresa_profissionais ep
  JOIN empresas e ON e.id = ep.empresa_id
  WHERE ep.profissional_id = auth.uid()
  AND e.empresa_tipo = 'tenant'
  LIMIT 1
)
SELECT 
  e.id,
  e.nome,
  e.empresa_tipo,
  e.tenant_id,
  'SECURITY BREACH: This company should NOT be visible!' as warning
FROM empresas e
CROSS JOIN my_tenant mt
WHERE e.empresa_tipo = 'operacional'
AND e.tenant_id != mt.tenant_id;

-- EXPECTED RESULT: 0 rows
-- If this returns ANY rows, RLS is NOT properly configured
-- and deployment is BLOCKED

-- =====================================================
-- STEP 3: Verify you can see your own tenant's companies
-- =====================================================
SELECT 
    id,
    nome,
    empresa_tipo,
    tenant_id,
    created_at
FROM empresas
WHERE empresa_tipo = 'operacional'
ORDER BY created_at DESC;

-- This should only show companies where tenant_id matches your tenant

-- =====================================================
-- STEP 4: Verify tenant companies visibility
-- =====================================================
SELECT 
    id,
    nome,
    empresa_tipo,
    tenant_id,
    created_at
FROM empresas
WHERE empresa_tipo = 'tenant'
ORDER BY created_at DESC;

-- If you're an admin, this should return 0 rows (or error due to RLS)
-- If you're a super admin, this should show all tenant companies

-- =====================================================
-- RLS Policy Verification
-- =====================================================

-- Check existing RLS policies on empresas table
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'empresas'
ORDER BY policyname;

-- Verify RLS is enabled
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
WHERE tablename = 'empresas';

-- rowsecurity should be TRUE

