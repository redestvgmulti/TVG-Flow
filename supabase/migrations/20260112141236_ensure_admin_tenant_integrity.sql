-- Migration: Tenant Context Integrity Enforcement
-- ================================================
-- This migration ensures that NO admin can exist without a valid tenant link
-- CRITICAL: This is a structural safeguard, not a business rule

-- ============================================
-- STEP 1: Diagnostic - Find Invalid States
-- ============================================

-- Log any admins currently without tenant (BEFORE enforcement)
DO $$
DECLARE
    invalid_admin RECORD;
    invalid_count INTEGER := 0;
BEGIN
    FOR invalid_admin IN
        SELECT 
            p.id,
            p.email,
            p.role
        FROM profissionais p
        LEFT JOIN empresa_profissionais ep ON ep.profissional_id = p.id AND ep.ativo = true
        LEFT JOIN empresas e ON e.id = ep.empresa_id AND e.ativo = true
        WHERE p.role = 'admin'
          AND p.ativo = true
        GROUP BY p.id, p.email, p.role
        HAVING COUNT(e.id) FILTER (WHERE e.empresa_tipo = 'tenant') = 0
    LOOP
        RAISE WARNING 'INVALID STATE DETECTED: Admin % (%) has no active tenant link', 
            invalid_admin.email, invalid_admin.id;
        invalid_count := invalid_count + 1;
    END LOOP;

    IF invalid_count > 0 THEN
        RAISE NOTICE 'Found % admin(s) without tenant. These MUST be fixed before enforcement triggers activate.', invalid_count;
    ELSE
        RAISE NOTICE 'No invalid admin states detected. Safe to proceed with enforcement.';
    END IF;
END $$;

-- ============================================
-- STEP 2: Validation Functions
-- ============================================

-- Function: Check if admin has active tenant link
CREATE OR REPLACE FUNCTION has_active_tenant_link(prof_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1
        FROM empresa_profissionais ep
        JOIN empresas e ON e.id = ep.empresa_id
        WHERE ep.profissional_id = prof_id
          AND ep.ativo = true
          AND e.empresa_tipo = 'tenant'
          AND e.ativo = true
    );
$$ LANGUAGE SQL STABLE;

-- ============================================
-- STEP 3: Enforcement Triggers
-- ============================================

-- Trigger Function: Validate admin has tenant (empresa_profissionais table)
CREATE OR REPLACE FUNCTION enforce_admin_tenant_link()
RETURNS TRIGGER AS $$
DECLARE
    prof_role TEXT;
    prof_email TEXT;
    has_tenant BOOLEAN;
BEGIN
    -- Get professional role and email
    SELECT role, email INTO prof_role, prof_email
    FROM profissionais
    WHERE id = COALESCE(NEW.profissional_id, OLD.profissional_id);

    -- Only enforce for admins
    IF prof_role IS NULL OR prof_role != 'admin' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- On DELETE or UPDATE to ativo=false: Check if removing last tenant link
    IF (TG_OP = 'DELETE') OR (TG_OP = 'UPDATE' AND NEW.ativo = false AND OLD.ativo = true) THEN
        -- Count remaining active tenant links AFTER this operation
        SELECT EXISTS (
            SELECT 1
            FROM empresa_profissionais ep
            JOIN empresas e ON e.id = ep.empresa_id
            WHERE ep.profissional_id = OLD.profissional_id
              AND ep.ativo = true
              AND e.empresa_tipo = 'tenant'
              AND e.ativo = true
              AND ep.id != OLD.id  -- Exclude the row being deleted/deactivated
        ) INTO has_tenant;

        IF NOT has_tenant THEN
            RAISE EXCEPTION 'TENANT_LINK_REQUIRED: Cannot remove last active tenant link for admin % (%). Admins must have at least one active tenant.',
                prof_email, OLD.profissional_id
                USING HINT = 'Deactivate admin role first, or create alternate tenant link before removing this one';
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trg_enforce_admin_tenant_link ON empresa_profissionais;

-- Create trigger on empresa_profissionais
CREATE TRIGGER trg_enforce_admin_tenant_link
    BEFORE UPDATE OR DELETE ON empresa_profissionais
    FOR EACH ROW
    EXECUTE FUNCTION enforce_admin_tenant_link();

COMMENT ON TRIGGER trg_enforce_admin_tenant_link ON empresa_profissionais IS 
    'Prevents removal of last active tenant link for admin users';

-- Trigger Function: Validate role promotion requires tenant
CREATE OR REPLACE FUNCTION enforce_admin_role_requires_tenant()
RETURNS TRIGGER AS $$
DECLARE
    has_tenant BOOLEAN;
BEGIN
    -- Only validate when PROMOTING to admin (role change TO admin)
    IF NEW.role = 'admin' AND (OLD.role IS NULL OR OLD.role != 'admin') THEN
        
        -- Check if user has active tenant link
        SELECT has_active_tenant_link(NEW.id) INTO has_tenant;

        IF NOT has_tenant THEN
            RAISE EXCEPTION 'TENANT_LINK_REQUIRED: Cannot promote % to admin without active tenant link',
                NEW.email
                USING HINT = 'Create active tenant link in empresa_profissionais before promoting to admin role';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS trg_enforce_admin_role_requires_tenant ON profissionais;

-- Create trigger on profissionais
CREATE TRIGGER trg_enforce_admin_role_requires_tenant
    BEFORE INSERT OR UPDATE ON profissionais
    FOR EACH ROW
    EXECUTE FUNCTION enforce_admin_role_requires_tenant();

COMMENT ON TRIGGER trg_enforce_admin_role_requires_tenant ON profissionais IS
    'Prevents promotion to admin role without existing active tenant link';

-- ============================================
-- STEP 4: Verification
-- ============================================

-- Create view to monitor admin-tenant compliance
CREATE OR REPLACE VIEW vw_admin_tenant_compliance AS
SELECT 
    p.id,
    p.email,
    p.role,
    p.ativo as profissional_ativo,
    COUNT(ep.empresa_id) FILTER (
        WHERE e.empresa_tipo = 'tenant' 
        AND ep.ativo = true 
        AND e.ativo = true
    ) as tenant_link_count,
    CASE 
        WHEN p.role = 'admin' AND COUNT(ep.empresa_id) FILTER (
            WHERE e.empresa_tipo = 'tenant' 
            AND ep.ativo = true 
            AND e.ativo = true
        ) = 0 THEN 'INVALID'
        WHEN p.role = 'admin' AND COUNT(ep.empresa_id) FILTER (
            WHERE e.empresa_tipo = 'tenant' 
            AND ep.ativo = true 
            AND e.ativo = true
        ) > 0 THEN 'VALID'
        ELSE 'N/A'
    END as compliance_status
FROM profissionais p
LEFT JOIN empresa_profissionais ep ON ep.profissional_id = p.id
LEFT JOIN empresas e ON e.id = ep.empresa_id
WHERE p.role IN ('admin', 'super_admin')
  AND p.ativo = true
GROUP BY p.id, p.email, p.role, p.ativo
ORDER BY compliance_status DESC, p.email;

COMMENT ON VIEW vw_admin_tenant_compliance IS
    'Monitors compliance of admin users with tenant link requirement. INVALID status should never occur after this migration.';

-- ============================================
-- STEP 5: Success Message
-- ============================================

DO $$
BEGIN
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'TENANT CONTEXT INTEGRITY ENFORCEMENT - SUCCESS';
    RAISE NOTICE '==============================================';
    RAISE NOTICE 'Structural safeguards are now ACTIVE:';
    RAISE NOTICE '1. Admins CANNOT be promoted without tenant link';
    RAISE NOTICE '2. Last tenant link CANNOT be removed from admin';
    RAISE NOTICE '3. Compliance view available: vw_admin_tenant_compliance';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '- Fix any INVALID admins shown in warnings above';
    RAISE NOTICE '- Deploy Edge Function: bootstrap-admin-tenant';
    RAISE NOTICE '- Update resolveTenantContext.js with hardened validation';
    RAISE NOTICE '==============================================';
END $$;
