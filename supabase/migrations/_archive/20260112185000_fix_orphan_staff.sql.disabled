-- Migration to link orphaned active staff users to the default tenant
-- Created at: 2026-01-12 18:50:00

DO $$
DECLARE
    v_tenant_id uuid;
    v_count integer := 0;
BEGIN
    -- 1. Get the default tenant ID (assuming the first active tenant found is the default)
    SELECT id INTO v_tenant_id
    FROM empresas
    WHERE empresa_tipo = 'tenant' AND ativo = true
    LIMIT 1;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'No active tenant found to link orphaned staff users.';
    END IF;

    -- 2. Identify and link orphaned ACTIVE professionals (excluding super_admin just in case, though they bypass this)
    -- We insert into empresa_profissionais for users who have NO records in that table.
    
    WITH orphans AS (
        SELECT p.id, p.email
        FROM profissionais p
        LEFT JOIN empresa_profissionais ep ON p.id = ep.profissional_id
        WHERE p.ativo = true
          AND p.role != 'super_admin' -- Super admin handles their own context
          AND ep.id IS NULL
    ),
    inserted AS (
        INSERT INTO empresa_profissionais (empresa_id, profissional_id, funcao, ativo, created_at)
        SELECT 
            v_tenant_id, 
            orphans.id, 
            'Colaborador', -- Default function name
            true, 
            NOW()
        FROM orphans
        RETURNING profissional_id
    )
    SELECT count(*) INTO v_count FROM inserted;

    RAISE NOTICE 'Linked % orphaned staff users to tenant %', v_count, v_tenant_id;

END $$;
