-- Migration: Fix Orphan Companies (Data Repair)
-- Description: Reclassifies incorrectly marked tenants and links operational companies to their parents.

DO $$
DECLARE
    r RECORD;
    parent_tenant_id UUID;
    updated_count INT := 0;
BEGIN
    -- 1. CORRECTION: Reclassify "Fake Tenants" to "Operacional"
    -- "Fake Tenant" = empresa_tipo 'tenant' but NO LINKED SUPER_ADMIN
    -- Only do this if we are sure. A safer bet is:
    -- If created by non-super-admin... referencing `owner_id` would be nice but we lack it.
    -- Logic: If a company has NO super_admin linked in `empresa_profissionais`, it CANNOT be a Platform Tenant managed by Super Admin.
    
    UPDATE empresas e
    SET empresa_tipo = 'operacional', tenant_id = NULL
    WHERE e.empresa_tipo = 'tenant'
    AND NOT EXISTS (
        SELECT 1 
        FROM empresa_profissionais ep
        JOIN profissionais p ON ep.profissional_id = p.id
        WHERE ep.empresa_id = e.id
        AND p.role = 'super_admin'
    );

    -- 2. LINKING: Connect Orphan Operational Companies to Parents
    -- For each operational company without a tenant_id
    FOR r IN 
        SELECT id, nome 
        FROM empresas 
        WHERE empresa_tipo = 'operacional' 
        AND tenant_id IS NULL 
    LOOP
        -- Find a parent tenant via linked admins
        SELECT t.id INTO parent_tenant_id
        FROM empresas t
        JOIN empresa_profissionais ep_tenant ON t.id = ep_tenant.empresa_id
        JOIN profissionais p ON ep_tenant.profissional_id = p.id
        -- Link to the orphan
        JOIN empresa_profissionais ep_orphan ON p.id = ep_orphan.profissional_id
        WHERE ep_orphan.empresa_id = r.id
        -- Ensure T is a Tenant
        AND t.empresa_tipo = 'tenant'
        -- Ensure P is an Admin (who would manage the orphan)
        -- AND (p.role = 'admin' OR ep_tenant.role = 'admin') -- Optional strictness
        LIMIT 1;

        -- Update if found
        IF parent_tenant_id IS NOT NULL THEN
            UPDATE empresas 
            SET tenant_id = parent_tenant_id 
            WHERE id = r.id;
            
            updated_count := updated_count + 1;
        END IF;
    END LOOP;

    RAISE NOTICE 'Restored % companies.', updated_count;
END $$;
