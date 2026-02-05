-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: FIX STAFF COMPANY VISIBILITY
-- DATE: 2026-02-03
-- DESCRIPTION:
-- The previous restrictive policy (20260209) inadvertently blocked 'Staff' users
-- from seeing companies they are linked to, because it enforced is_admin_safe().
-- This fix opens read access to ANY authenticated user who has a valid link
-- in empresa_profissionais.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. Drop the overly restrictive policy
DROP POLICY IF EXISTS "Global Constraint: Read Isolation for Companies" ON empresas;

-- 2. Re-create with inclusive logic
CREATE POLICY "Global Constraint: Read Isolation for Companies"
ON empresas
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
    -- CASE 1: Super Admin (Global Access)
    public.is_super_admin()
    
    OR
    
    -- CASE 2: Linked Users (Admin OR Staff)
    -- If you are linked to the company, you can see it.
    (
        EXISTS (
            SELECT 1 
            FROM empresa_profissionais ep
            WHERE ep.empresa_id = empresas.id
            AND ep.profissional_id = auth.uid()
            AND ep.ativo = true
        )
    )

    OR

    -- CASE 3: Admin managing Sub-Companies (Operational)
    -- Admins need to see operational companies under their tenant, even if not directly linked to them?
    -- (Usually admins ARE linked to the tenant, but maybe not the sub-company record directly?)
    -- Keeping the previous logic for Admins just in case they need visibility over child companies.
    (
        public.is_admin_safe()
        AND
        empresa_tipo = 'operacional'
        AND
        public.is_admin_of_tenant(tenant_id)
    )
);
