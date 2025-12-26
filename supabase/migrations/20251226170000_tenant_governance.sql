-- Migration: Tenant Governance (Super Admin v1.1)
-- Description: Adds CNPJ to companies, and safe RPCs for tenant onboarding and management.

-- 1. Add CNPJ column to 'empresas'
DO $$ BEGIN
    ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cnpj TEXT;
    -- Optional: Add unique constraint if desired, but might conflict with bad data. 
    -- Adding a soft check for now to allow 'unknown' in legacy data.
EXCEPTION
    WHEN duplicate_column THEN NULL;
END $$;

-- 2. Validate/Bootstrap Legacy Data (Phase 1 of Plan)
-- Ensure all companies have a valid status and type.
UPDATE empresas SET status_conta = 'active' WHERE status_conta IS NULL;
UPDATE empresas SET icp_status = 'doubtful' WHERE icp_status IS NULL;
UPDATE empresas SET tipo_negocio = 'other' WHERE tipo_negocio IS NULL;


-- 3. RPC: Get Tenant Details (Aggregated View for Super Admin)
CREATE OR REPLACE FUNCTION get_tenant_details(target_company_id UUID)
RETURNS TABLE (
    id UUID,
    nome TEXT,
    cnpj TEXT,
    status_conta TEXT,
    internal_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    admins_count BIGINT,
    staff_count BIGINT,
    admins_list JSON,
    health_status TEXT
) AS $$
DECLARE
    calc_health TEXT;
BEGIN
    SELECT 
        CASE
            WHEN e.last_activity_at > NOW() - INTERVAL '7 days' THEN 'healthy'
            WHEN e.last_activity_at > NOW() - INTERVAL '14 days' THEN 'low_activity'
            ELSE 'inactive'
        END INTO calc_health
    FROM empresas e WHERE e.id = target_company_id;

    RETURN QUERY
    SELECT 
        e.id,
        e.nome,
        e.cnpj,
        e.status_conta,
        e.internal_notes,
        e.created_at,
        (
            SELECT COUNT(*) 
            FROM empresa_profissionais ep 
            JOIN profissionais p ON p.id = ep.profissional_id
            WHERE ep.empresa_id = e.id AND p.role = 'admin'
        ) as admins_count,
        (
            SELECT COUNT(*) 
            FROM empresa_profissionais ep 
            WHERE ep.empresa_id = e.id
        ) as staff_count,
        (
            SELECT json_agg(json_build_object(
                'id', p.id,
                'nome', p.nome,
                'email', p.email,
                'ativo', p.ativo,
                'role', p.role
            ))
            FROM empresa_profissionais ep
            JOIN profissionais p ON p.id = ep.profissional_id
            WHERE ep.empresa_id = e.id AND p.role = 'admin'
        ) as admins_list,
        calc_health as health_status
    FROM empresas e
    WHERE e.id = target_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 4. RPC: Create Tenant (Transactional DB Side)
-- This function assumes the Auth User (for the first admin) is created separaterly (or passed in if using a specific flow).
-- To adhere to "Transactional: Company + Admin", we will insert the DB records here.
-- The Frontend must: 1. Create Auth User, 2. Call this RPC with the new User ID.
CREATE OR REPLACE FUNCTION create_tenant_db(
    p_company_name TEXT,
    p_cnpj TEXT,
    p_admin_id UUID,
    p_admin_name TEXT,
    p_admin_email TEXT
) RETURNS UUID AS $$
DECLARE
    new_company_id UUID;
BEGIN
    -- 1. Create Company
    INSERT INTO empresas (nome, cnpj, status_conta, icp_status, tipo_negocio)
    VALUES (p_company_name, p_cnpj, 'active', 'correct', 'other')
    RETURNING id INTO new_company_id;

    -- 2. Ensure Professional Profile Exists (Auth trigger might have created it, but we enforce role)
    INSERT INTO profissionais (id, nome, email, role, ativo)
    VALUES (p_admin_id, p_admin_name, p_admin_email, 'admin', true)
    ON CONFLICT (id) DO UPDATE
    SET role = 'admin', nome = p_admin_name, ativo = true;

    -- 3. Link Admin to Company
    INSERT INTO empresa_profissionais (empresa_id, profissional_id)
    VALUES (new_company_id, p_admin_id)
    ON CONFLICT (empresa_id, profissional_id) DO NOTHING;

    RETURN new_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
