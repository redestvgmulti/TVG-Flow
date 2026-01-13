-- Migration: Fix Admin Tenant Links (Data Correction)
-- ===================================================
-- Description:
-- 1. Identifies admins without active tenant links
-- 2. Identifies the first available active 'tenant' company
-- 3. Automatically creates links for these admins to restore integrity
-- 4. Logs all actions

DO $$
DECLARE
    target_tenant_id UUID;
    target_tenant_name TEXT;
    invalid_admin RECORD;
    fixed_count INTEGER := 0;
    link_exists BOOLEAN;
BEGIN
    -- 1. Find a valid tenant to link to (FAIL-SAFE: First active tenant created)
    SELECT id, nome INTO target_tenant_id, target_tenant_name
    FROM empresas
    WHERE empresa_tipo = 'tenant'
      AND ativo = true
    ORDER BY created_at ASC
    LIMIT 1;

    -- Stops if no tenant exists (System is too empty to fix)
    IF target_tenant_id IS NULL THEN
        RAISE WARNING 'SKIPPING FIX: No active tenant company found in database. Create a tenant company first.';
        RETURN;
    END IF;

    RAISE NOTICE 'Target Tenant for Fix: % (%)', target_tenant_name, target_tenant_id;

    -- 2. Iterate over invalid admins
    -- We use the logic from the view directly to be safe, or just query the view if it exists
    FOR invalid_admin IN
        SELECT p.id, p.email, p.role
        FROM profissionais p
        WHERE p.role IN ('admin', 'super_admin')
          AND p.ativo = true
          AND NOT EXISTS (
              SELECT 1
              FROM empresa_profissionais ep
              JOIN empresas e ON e.id = ep.empresa_id
              WHERE ep.profissional_id = p.id
                AND ep.ativo = true
                AND e.empresa_tipo = 'tenant'
                AND e.ativo = true
          )
    LOOP
        RAISE NOTICE 'Fixing orphaned admin: % (%)', invalid_admin.email, invalid_admin.id;

        -- Double check if link really doesn't exist (safety)
        SELECT EXISTS (
            SELECT 1 FROM empresa_profissionais 
            WHERE profissional_id = invalid_admin.id 
            AND empresa_id = target_tenant_id
        ) INTO link_exists;

        IF link_exists THEN
            -- Reactivate if exists but inactive
            UPDATE empresa_profissionais
            SET ativo = true, funcao = 'Administração (Restored)'
            WHERE profissional_id = invalid_admin.id 
            AND empresa_id = target_tenant_id;
            
            RAISE NOTICE '-> Reactivated existing link';
        ELSE
            -- Insert new link
            INSERT INTO empresa_profissionais (
                profissional_id,
                empresa_id,
                funcao,
                ativo,
                created_at
            ) VALUES (
                invalid_admin.id,
                target_tenant_id,
                'Administração (Auto-Fix)',
                true,
                NOW()
            );
            
            RAISE NOTICE '-> Created new link';
        END IF;

        fixed_count := fixed_count + 1;
    END LOOP;

    RAISE NOTICE '==================================================';
    RAISE NOTICE 'FIX SUMMARY: % admins repaired', fixed_count;
    RAISE NOTICE '==================================================';

END $$;
