-- Migration: Fix Orphan Admins & Bootstrap Trigger
-- Description: 
-- 1. Repairs data: Links all orphan admins to the first available Tenant company.
-- 2. Automation: Adds trigger to ensure future admins are automatically linked.

-- ==========================================
-- SECTION 1: DATA REPAIR (One-off Fix)
-- ==========================================

DO $$
DECLARE
    target_tenant_id UUID;
    orphan_count INTEGER := 0;
BEGIN
    -- 1. Identify the default tenant (Target for repairs)
    -- We assume the first active tenant found is the correct "Headquarters"
    SELECT id INTO target_tenant_id
    FROM empresas
    WHERE empresa_tipo = 'tenant' AND ativo = true
    LIMIT 1;

    IF target_tenant_id IS NULL THEN
        RAISE WARNING 'ABORTING REPAIR: No active tenant company found. Please create a tenant company first.';
        RETURN;
    END IF;

    -- 2. Find and Fix Orphan Admins
    -- Logic: Admins who have ZERO links to a tenant company
    INSERT INTO empresa_profissionais (id, empresa_id, profissional_id, funcao, ativo, created_at)
    SELECT 
        gen_random_uuid(),         -- New ID
        target_tenant_id,          -- The Tenant Company
        p.id,                      -- The Orphan Admin
        'Admin Repaired',          -- Role description
        true,                      -- Active
        NOW()                      -- Created now
    FROM profissionais p
    WHERE p.role = 'admin' AND p.ativo = true
    AND NOT EXISTS (
        SELECT 1 
        FROM empresa_profissionais ep 
        JOIN empresas e ON e.id = ep.empresa_id 
        WHERE ep.profissional_id = p.id 
          AND e.empresa_tipo = 'tenant'
);

    GET DIAGNOSTICS orphan_count = ROW_COUNT;

    IF orphan_count > 0 THEN
        RAISE NOTICE 'SUCCESS: Repaired % orphan admin(s). Linked to Tenant ID: %', orphan_count, target_tenant_id;
    ELSE
        RAISE NOTICE 'NO REPAIRS NEEDED: All admins already valid.';
    END IF;

END $$;

-- ==========================================
-- SECTION 2: BOOTSTRAP AUTOMATION (Future Proofing)
-- ==========================================

-- Function: Auto-link admin to tenant on promotion/creation
CREATE OR REPLACE FUNCTION bootstrap_admin_tenant_link()
RETURNS TRIGGER AS $$
DECLARE
    default_tenant_id UUID;
BEGIN
    -- Only run if user is ADMIN and ACTIVE
    IF NEW.role = 'admin' AND NEW.ativo = true THEN
        
        -- Check if link already exists
        IF NOT EXISTS (
            SELECT 1 
            FROM empresa_profissionais ep 
            JOIN empresas e ON e.id = ep.empresa_id 
            WHERE ep.profissional_id = NEW.id 
              AND e.empresa_tipo = 'tenant'
) THEN
            -- Find default tenant
            SELECT id INTO default_tenant_id
            FROM empresas
            WHERE empresa_tipo = 'tenant' AND ativo = true
            LIMIT 1;

            IF default_tenant_id IS NOT NULL THEN
                -- Create the link safely
                INSERT INTO empresa_profissionais (id, empresa_id, profissional_id, funcao, ativo)
                VALUES (gen_random_uuid(), default_tenant_id, NEW.id, 'Admin Auto-Linked', true);
                
                RAISE NOTICE 'BOOTSTRAP: Auto-linked admin % to tenant %', NEW.email, default_tenant_id;
            ELSE
                RAISE WARNING 'BOOTSTRAP FAILED: No tenant found for admin %', NEW.email;
            END IF;
        END IF;

    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: Run BEFORE updates/inserts on `profissionais`
-- We use AFTER to avoid circular dependency locks if possible, but BEFORE is fine for logic validation. 
-- However, for inserting into ANOTHER table (`empresa_profissionais`), AFTER is safer to ensure `profissionais` row exists.
DROP TRIGGER IF EXISTS trg_bootstrap_admin_tenant ON profissionais;

CREATE TRIGGER trg_bootstrap_admin_tenant
    AFTER INSERT OR UPDATE ON profissionais
    FOR EACH ROW
    EXECUTE FUNCTION bootstrap_admin_tenant_link();

COMMENT ON TRIGGER trg_bootstrap_admin_tenant ON profissionais IS 
    'Automatically links admins to the default tenant if no link exists, ensuring integrity.';
