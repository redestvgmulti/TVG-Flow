-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: SAAS TENANT ISOLATION (EMPRESAS) - FINAL REFINED (V2)
-- DATE: 2026-01-23
-- DESCRIPTION: Applies strict "AS RESTRICTIVE" policies to 'empresas'.
-- 1. SELECT: Super Admin (All), Admin (Own Tenant), Staff (None).
-- 2. WRITE: Super Admin (All), Others (None).
-- 3. UPDATES: Required WITH CHECK enforcement.
-- 4. PERFORMANCE: Optimized index for link table.
-- 5. SAFETY: Uses is_admin_safe() to prevent recursion.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- Drop previous policies to ensure clean state
DO $$
BEGIN
    DROP POLICY IF EXISTS "Global Constraint: Tenant Isolation for Companies" ON empresas;
    DROP POLICY IF EXISTS "Global Constraint: Read Isolation for Companies" ON empresas;
    DROP POLICY IF EXISTS "Global Constraint: Write Isolation for Companies" ON empresas;
    DROP POLICY IF EXISTS "Global Constraint: Modify Isolation for Companies" ON empresas;
    DROP POLICY IF EXISTS "Global Constraint: Delete Isolation for Companies" ON empresas;
END $$;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 1. PERFORMANCE INDEX
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Optimize frequent RLS lookups on the link table
CREATE INDEX IF NOT EXISTS idx_empresa_profissionais_lookup
ON empresa_profissionais (empresa_id, profissional_id)
WHERE ativo = true;

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. POLICY: READ ACCESS (SELECT)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE POLICY "Global Constraint: Read Isolation for Companies"
ON empresas
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
    -- 1. Super Admin: Global Access
    public.is_super_admin()
    
    OR 
    
    -- 2. Admin: Own Tenant Only
    (
        public.is_admin_safe() -- ✅ SAFE CHECK
        AND
        -- Must be linked to the company
        EXISTS (
            SELECT 1 
            FROM empresa_profissionais ep
            WHERE ep.empresa_id = empresas.id
            AND ep.profissional_id = auth.uid()
            AND ep.ativo = true
        )
    )
    
    -- 3. Staff: Implicitly excluded (Result is FALSE for them)
);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. POLICY: WRITE ACCESS (INSERT, UPDATE, DELETE)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- INSERT: Super Admin Only
CREATE POLICY "Global Constraint: Write Isolation for Companies"
ON empresas
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_super_admin()
);

-- UPDATE: Super Admin Only
CREATE POLICY "Global Constraint: Modify Isolation for Companies"
ON empresas
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
    public.is_super_admin()
)
WITH CHECK (
    public.is_super_admin()
);

-- DELETE: Super Admin Only
CREATE POLICY "Global Constraint: Delete Isolation for Companies"
ON empresas
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
    public.is_super_admin()
);
