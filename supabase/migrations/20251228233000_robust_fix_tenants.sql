-- Migration: Robust Fix for Demoted Tenants (Broad Scope)
-- Description: Promotes ANY Operational company that has NULL tenant_id and has linked professionals.
-- Assumption: If it has no tenant_id, it is a Root company. If it has professionals, it's a Tenant.
-- We relax the 'admin' role check because data might be messy (e.g. 'Admin', 'ADMIN', or just 'responsavel').

DO $$
DECLARE
    promoted_count INT := 0;
BEGIN
    -- 1. Promote all Root Operational Companies to Tenant
    UPDATE empresas
    SET empresa_tipo = 'tenant'
    WHERE empresa_tipo = 'operacional'
    AND tenant_id IS NULL
    AND EXISTS (
        SELECT 1 
        FROM empresa_profissionais ep 
        WHERE ep.empresa_id = empresas.id
    );
    
    GET DIAGNOSTICS promoted_count = ROW_COUNT;
    RAISE NOTICE 'Force-promoted % root operational companies to Tenant.', promoted_count;

    -- 2. Clean up: If any operational company has tenant_id but that tenant_id DOES NOT exist or is invalid?
    -- (Skipping for now, focus on the visibility issue)

    -- 3. Re-link orphans (Pass 2)
    -- Just in case some orphans didn't match before because the parent wasn't a tenant yet.
    UPDATE empresas e
    SET tenant_id = (
        SELECT t.id
        FROM empresas t
        JOIN empresa_profissionais ep_tenant ON t.id = ep_tenant.empresa_id
        JOIN profissionais p ON ep_tenant.profissional_id = p.id
        JOIN empresa_profissionais ep_orphan ON p.id = ep_orphan.profissional_id
        WHERE ep_orphan.empresa_id = e.id
        AND t.empresa_tipo = 'tenant'
        AND t.id != e.id
        LIMIT 1
    )
    WHERE e.empresa_tipo = 'operacional'
    AND e.tenant_id IS NULL;

END $$;
