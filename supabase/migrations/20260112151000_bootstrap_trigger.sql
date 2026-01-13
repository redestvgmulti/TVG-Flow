-- Migration: Bootstrap Admin Tenant Trigger
-- =======================================
-- Description:
-- Replaces/Augments manual Edge Function logic with DB-level guarantee.
-- Whenever a user is inserted as 'admin' or updated to 'admin',
-- this trigger ensures they are linked to a tenant immediately.

CREATE OR REPLACE FUNCTION bootstrap_admin_tenant_link()
RETURNS TRIGGER AS $$
DECLARE
    target_tenant_id UUID;
    prof_id UUID;
    prof_email TEXT;
    prof_role TEXT;
    link_exists BOOLEAN;
BEGIN
    prof_id := NEW.id;
    prof_email := NEW.email;
    prof_role := NEW.role;

    -- Only proceed if role is admin or super_admin
    IF prof_role NOT IN ('admin', 'super_admin') THEN
        RETURN NEW;
    END IF;

    -- Check if tenant link already exists
    SELECT EXISTS (
        SELECT 1
        FROM empresa_profissionais ep
        JOIN empresas e ON e.id = ep.empresa_id
        WHERE ep.profissional_id = prof_id
          AND ep.ativo = true
          AND e.empresa_tipo = 'tenant'
          AND e.ativo = true
    ) INTO link_exists;

    IF link_exists THEN
        -- Already valid, do nothing
        RETURN NEW;
    END IF;

    -- Need to bootstrap! Find first active tenant
    SELECT id INTO target_tenant_id
    FROM empresas
    WHERE empresa_tipo = 'tenant'
      AND ativo = true
    ORDER BY created_at ASC
    LIMIT 1;

    IF target_tenant_id IS NULL THEN
        RAISE WARNING 'BOOTSTRAP FAILED: No active tenant company found for admin %', prof_email;
        -- We do NOT raise exception here to avoid blocking user creation if system is empty
        -- The integrity check view will catch this later
        RETURN NEW;
    END IF;

    -- Insert link
    -- We use a separate INSERT statement. Since this is a BEFORE trigger, 
    -- we can't easily insert into a related table comfortably without risk of side effects,
    -- BUT for unrelated tables (empresa_profissionais) it is allowed in Postgres.
    -- However, it is safer to do this in an AFTER trigger.
    -- Let's check trigger definition.
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Split logic: 
-- The TRIGGER must be AFTER insert/update to safely insert into related table
-- ensuring the professional record exists fully.

CREATE OR REPLACE FUNCTION bootstrap_admin_tenant_link_after()
RETURNS TRIGGER AS $$
DECLARE
    target_tenant_id UUID;
    link_exists BOOLEAN;
BEGIN
    -- Only for admins
    IF NEW.role NOT IN ('admin', 'super_admin') THEN
        RETURN NEW;
    END IF;

    -- Check existence
    SELECT EXISTS (
        SELECT 1
        FROM empresa_profissionais ep
        JOIN empresas e ON e.id = ep.empresa_id
        WHERE ep.profissional_id = NEW.id
          AND ep.ativo = true
          AND e.empresa_tipo = 'tenant'
          AND e.ativo = true
    ) INTO link_exists;

    IF link_exists THEN
        RETURN NEW;
    END IF;

    -- Find tenant
    SELECT id INTO target_tenant_id
    FROM empresas
    WHERE empresa_tipo = 'tenant'
      AND ativo = true
    ORDER BY created_at ASC
    LIMIT 1;

    IF target_tenant_id IS NOT NULL THEN
        -- Create link
        INSERT INTO empresa_profissionais (
            profissional_id,
            empresa_id,
            funcao,
            ativo,
            created_at
        ) VALUES (
            NEW.id,
            target_tenant_id,
            'Administração (Bootstrap)',
            true,
            NOW()
        )
        ON CONFLICT DO NOTHING;
        
        RAISE NOTICE 'Bootstrapped tenant link for admin %', NEW.email;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop old triggers if any mismatch
DROP TRIGGER IF EXISTS trg_bootstrap_admin_tenant ON profissionais;

-- Create AFTER trigger
CREATE TRIGGER trg_bootstrap_admin_tenant
    AFTER INSERT OR UPDATE ON profissionais
    FOR EACH ROW
    EXECUTE FUNCTION bootstrap_admin_tenant_link_after();

COMMENT ON TRIGGER trg_bootstrap_admin_tenant ON profissionais IS
    'Automatically links new/promoted admins to the first default tenant';
