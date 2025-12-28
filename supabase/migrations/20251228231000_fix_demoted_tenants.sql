-- Migration: Fix Wrongly Demoted Tenants
-- Description: Re-promotes "Operacional" companies to "Tenant" if they have Admins and no Parent.
-- This fixes the issue where valid SaaS Tenants were demoted because they lacked a Super Admin link.

DO $$
DECLARE
    promoted_count INT := 0;
BEGIN
    -- Update logic:
    -- Find Operational companies that exist as "Roots" (no tenant_id)
    -- AND have an Admin user linked. These are effectively Tenants.
    
    WITH rows_to_update AS (
        SELECT e.id
        FROM empresas e
        WHERE e.empresa_tipo = 'operacional'
        AND e.tenant_id IS NULL
        AND EXISTS (
            SELECT 1 
            FROM empresa_profissionais ep
            JOIN profissionais p ON ep.profissional_id = p.id
            WHERE ep.empresa_id = e.id
            AND (p.role = 'admin' OR ep.funcao = 'admin') 
            -- Check for 'admin' role in either table to be robust
        )
    )
    UPDATE empresas
    SET empresa_tipo = 'tenant'
    WHERE id IN (SELECT id FROM rows_to_update);
    
    GET DIAGNOSTICS promoted_count = ROW_COUNT;
    
    RAISE NOTICE 'Repromoted % companies to Tenant status.', promoted_count;

    -- Optional: After promoting Tenants, we might want to re-run the "Link Orphans" logic?
    -- Because now we have valid Tenants, orphans might find their parents.
    -- Let's include a small linking pass just in case.

    UPDATE empresas e
    SET tenant_id = (
        SELECT t.id
        FROM empresas t
        JOIN empresa_profissionais ep_tenant ON t.id = ep_tenant.empresa_id
        JOIN profissionais p ON ep_tenant.profissional_id = p.id
        JOIN empresa_profissionais ep_orphan ON p.id = ep_orphan.profissional_id
        WHERE ep_orphan.empresa_id = e.id
        AND t.empresa_tipo = 'tenant'
        AND t.id != e.id -- Don't link key to itself
        LIMIT 1
    )
    WHERE e.empresa_tipo = 'operacional'
    AND e.tenant_id IS NULL;

END $$;
