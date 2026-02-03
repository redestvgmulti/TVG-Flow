-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- MIGRATION: RLS GOVERNANCE FIX (ADMIN & SUPER ADMIN)
-- DATE: 2026-02-03
-- DESCRIPTION: 
-- 1. Fixes 403 for Admins creating Operational Companies.
-- 2. Restricts Super Admins from creating companies for Tenants that already have an existing Admin.
-- 3. Ensures Helper Functions exist (Self-Healing).
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 0. Ensure Basic Permission Helpers Exist (Self-healing)

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profissionais
    WHERE id = auth.uid()
    AND role = 'super_admin'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin TO service_role;


CREATE OR REPLACE FUNCTION public.is_admin_safe()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profissionais
    WHERE id = auth.uid()
    AND role = 'admin'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_safe TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_safe TO service_role;


-- 1. Helper Function: Check if Tenant has an Admin
CREATE OR REPLACE FUNCTION public.has_tenant_admin(target_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- If no tenant_id provided (e.g. creating a Tenant itself), return FALSE so NOT FALSE = TRUE (Allow)
    IF target_tenant_id IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM empresa_profissionais ep
        JOIN profissionais p ON p.id = ep.profissional_id
        WHERE ep.empresa_id = target_tenant_id
        AND p.role = 'admin'
        AND ep.ativo = true
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_tenant_admin TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_tenant_admin TO service_role;


-- 2. Helper Function: Check if User is Admin of the Target Tenant
-- Used to ensure Admins only create companies for their own Tenant
CREATE OR REPLACE FUNCTION public.is_admin_of_tenant(target_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF target_tenant_id IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1 
        FROM empresa_profissionais ep
        WHERE ep.empresa_id = target_tenant_id
        AND ep.profissional_id = auth.uid()
        AND ep.ativo = true
        -- Implicitly checks if user is admin via is_admin_safe() in the policy, but redundancy is fine
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin_of_tenant TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_of_tenant TO service_role;


-- 3. DROP OLD RESTRICTIVE POLICIES
DROP POLICY IF EXISTS "Global Constraint: Write Isolation for Companies" ON empresas;
DROP POLICY IF EXISTS "Global Constraint: Modify Isolation for Companies" ON empresas;
DROP POLICY IF EXISTS "Global Constraint: Delete Isolation for Companies" ON empresas;
DROP POLICY IF EXISTS "Global Constraint: Read Isolation for Companies" ON empresas;


-- 4. APPLY NEW POLICIES

-- SELECT POLICY (Fix Visibility for Admin's Operational Companies)
CREATE POLICY "Global Constraint: Read Isolation for Companies"
ON empresas
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
    -- CASE 1: Super Admin (Global Access)
    public.is_super_admin()
    
    OR
    
    -- CASE 2: Admin (Own Tenant + Child Operational Companies)
    (
        public.is_admin_safe()
        AND
        (
            -- A) The Tenant Company itself (Directly linked)
            public.is_admin_of_tenant(id)
            
            OR
            
            -- B) Operational Company belonging to the Admin's Tenant
            (
                empresa_tipo = 'operacional'
                AND
                public.is_admin_of_tenant(tenant_id)
            )
        )
    )
);

-- INSERT POLICY
CREATE POLICY "Global Constraint: Write Isolation for Companies"
ON empresas
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
    -- CASE 1: Super Admin (Subject to Governance)
    (
        public.is_super_admin() 
        AND 
        NOT public.has_tenant_admin(tenant_id) -- BLOCK if Tenant has Admin
    )
    
    OR
    
    -- CASE 2: Admin (Fix 403)
    (
        public.is_admin_safe()
        AND
        empresa_tipo = 'operacional' -- Strict: Only Operational
        AND
        public.is_admin_of_tenant(tenant_id) -- Strict: Own Tenant Only
    )
);

-- UPDATE POLICY
CREATE POLICY "Global Constraint: Modify Isolation for Companies"
ON empresas
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
    -- CASE 1: Super Admin (Subject to Governance)
    (
        public.is_super_admin() 
        AND 
        NOT public.has_tenant_admin(tenant_id)
    )
    
    OR
    
    -- CASE 2: Admin
    (
        public.is_admin_safe()
        AND
        empresa_tipo = 'operacional'
        AND
        public.is_admin_of_tenant(tenant_id)
    )
)
WITH CHECK (
    -- CASE 1: Super Admin
    (
        public.is_super_admin() 
        AND 
        NOT public.has_tenant_admin(tenant_id)
    )
    
    OR
    
    -- CASE 2: Admin
    (
        public.is_admin_safe()
        AND
        empresa_tipo = 'operacional'
        AND
        public.is_admin_of_tenant(tenant_id)
    )
);

-- DELETE POLICY
CREATE POLICY "Global Constraint: Delete Isolation for Companies"
ON empresas
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
    -- CASE 1: Super Admin (Subject to Governance)
    (
        public.is_super_admin() 
        AND 
        NOT public.has_tenant_admin(tenant_id)
    )
    
    OR
    
    -- CASE 2: Admin
    (
        public.is_admin_safe()
        AND
        empresa_tipo = 'operacional'
        AND
        public.is_admin_of_tenant(tenant_id)
    )
);
