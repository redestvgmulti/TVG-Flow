-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: SAAS TENANT ISOLATION (EMPRESAS)
-- DATE: 2026-01-23
-- DESCRIPTION: Applies "AS RESTRICTIVE" policy to 'empresas' table.
-- Ensures that Admins (and Staff) can ONLY see/manage companies they belong to.
-- Super Admins retain global access.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
BEGIN
    DROP POLICY IF EXISTS "Global Constraint: Tenant Isolation for Companies" ON empresas;
END $$;

CREATE POLICY "Global Constraint: Tenant Isolation for Companies"
ON empresas
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
    -- 1. Super Admin: Global Access
    (
        EXISTS (
            SELECT 1 FROM profissionais 
            WHERE id = auth.uid() 
            AND role = 'super_admin'
        )
    )
    
    OR 
    
    -- 2. Tenant Isolation
    -- Any other user (Admin or Staff) must have an active link to the company
    EXISTS (
        SELECT 1 
        FROM empresa_profissionais ep
        WHERE ep.empresa_id = empresas.id
        AND ep.profissional_id = auth.uid()
        AND ep.ativo = true
    )
);

-- Note: We use INLINED check for Super Admin to ensure robustness against function changes.
-- This restricts the previously permissive "Admin can manage all companies" policy.
