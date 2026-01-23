-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: RLS HARDENING PHASE 2 (PROFISSIONAIS ISOLATION)
-- DATE: 2026-01-23
-- DESCRIPTION: Applies strict tenant isolation for viewing professionals.
-- Admins can only see professionals from their own companies.
-- Super Admins retain full global access.
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DO $$
BEGIN
    DROP POLICY IF EXISTS "Global Constraint: Tenant Isolation for Professionals" ON profissionais;
END $$;

CREATE POLICY "Global Constraint: Tenant Isolation for Professionals"
ON profissionais
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
    -- 1. Super Admin: Global Access
    public.is_super_admin()
    
    OR 
    
    -- 2. Tenant Isolation
    -- Allows access ONLY if there is a shared 'active' company between
    -- the current user (auth.uid) and the target professional (profissionais.id).
    EXISTS (
        SELECT 1
        FROM public.empresa_profissionais ep1 -- My companies
        JOIN public.empresa_profissionais ep2 -- Target's companies
          ON ep1.empresa_id = ep2.empresa_id
        WHERE ep1.profissional_id = auth.uid()
          AND ep2.profissional_id = profissionais.id
          AND ep1.ativo = true
          AND ep2.ativo = true
    )
    
    OR
    
    -- 3. Self Access (Always allow user to see themselves)
    (id = auth.uid())
);
